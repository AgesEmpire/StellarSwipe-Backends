import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ComplianceLog } from './entities/compliance-log.entity';
import { User, KycStatus } from '../users/entities/user.entity';
import {
  CheckTradeEligibilityDto,
  TradeEligibilityResult,
} from './dto/trade-eligibility.dto';

@Injectable()
export class TradeEligibilityService {
  private readonly logger = new Logger(TradeEligibilityService.name);

  /** Restricted country codes — configurable via RESTRICTED_COUNTRIES env var */
  private readonly restrictedCountries: Set<string>;

  /** Asset classes that require enhanced KYC */
  private readonly restrictedAssets: Set<string>;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ComplianceLog)
    private readonly complianceLogRepo: Repository<ComplianceLog>,
    private readonly config: ConfigService,
  ) {
    const countries = this.config.get<string>('RESTRICTED_COUNTRIES', 'CU,IR,KP,SY,RU');
    this.restrictedCountries = new Set(countries.split(',').map((c) => c.trim().toUpperCase()));

    const assets = this.config.get<string>('RESTRICTED_ASSETS', '');
    this.restrictedAssets = new Set(
      assets ? assets.split(',').map((a) => a.trim().toUpperCase()) : [],
    );
  }

  async checkEligibility(dto: CheckTradeEligibilityDto): Promise<TradeEligibilityResult> {
    const reasons: string[] = [];
    const checkedRules: string[] = [];

    // Rule 1: Geographic restriction
    checkedRules.push('geo_restriction');
    if (dto.countryCode && this.restrictedCountries.has(dto.countryCode.toUpperCase())) {
      reasons.push(`Trading is not permitted from region: ${dto.countryCode}`);
    }

    // Rule 2: KYC/AML status
    checkedRules.push('kyc_aml_status');
    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (!user) {
      reasons.push('User account not found');
    } else if (user.kycStatus !== KycStatus.VERIFIED) {
      reasons.push(`KYC verification required. Current status: ${user.kycStatus}`);
    }

    // Rule 3: Restricted asset class
    checkedRules.push('asset_class_restriction');
    const base = dto.baseAsset.toUpperCase();
    const counter = dto.counterAsset.toUpperCase();
    if (this.restrictedAssets.has(base) || this.restrictedAssets.has(counter)) {
      const restricted = [base, counter].filter((a) => this.restrictedAssets.has(a));
      reasons.push(`Asset(s) not eligible for trading: ${restricted.join(', ')}`);
    }

    // Rule 4: AML large-transaction flag
    checkedRules.push('aml_transaction_threshold');
    const amlThreshold = this.config.get<number>('AML_THRESHOLD', 100000);
    if (dto.amount > amlThreshold) {
      reasons.push(`Transaction amount ${dto.amount} exceeds AML threshold of ${amlThreshold}`);
    }

    const eligible = reasons.length === 0;
    const result: TradeEligibilityResult = {
      eligible,
      reasons,
      checkedRules,
      decidedAt: new Date().toISOString(),
    };

    await this.logDecision(dto, result);
    return result;
  }

  private async logDecision(
    dto: CheckTradeEligibilityDto,
    result: TradeEligibilityResult,
  ): Promise<void> {
    try {
      const log = this.complianceLogRepo.create({
        type: result.eligible ? 'transaction_allowed' : 'transaction_blocked',
        userId: dto.userId,
        countryCode: dto.countryCode,
        reason: result.eligible ? 'All compliance rules passed' : result.reasons.join('; '),
        ipAddress: '0.0.0.0',
        metadata: {
          baseAsset: dto.baseAsset,
          counterAsset: dto.counterAsset,
          amount: dto.amount,
          checkedRules: result.checkedRules,
        },
      });
      await this.complianceLogRepo.save(log);
    } catch (err) {
      this.logger.error(`Failed to log compliance decision: ${(err as Error).message}`);
    }
  }
}
