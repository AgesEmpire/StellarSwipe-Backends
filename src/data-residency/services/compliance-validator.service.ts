import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResidencyPolicy } from '../entities/residency-policy.entity';
import { RegionCode } from '../entities/data-region.entity';
import {
  ComplianceCheckDto,
  ComplianceResultDto,
  ComplianceStatus,
  ComplianceViolationDto,
} from '../dto/residency-compliance.dto';
import { EuStorageStrategy } from '../strategies/eu-storage.strategy';
import { AsiaStorageStrategy } from '../strategies/asia-storage.strategy';

@Injectable()
export class ComplianceValidatorService {
  private readonly logger = new Logger(ComplianceValidatorService.name);

  constructor(
    @InjectRepository(ResidencyPolicy)
    private readonly policyRepo: Repository<ResidencyPolicy>,
    private readonly euStrategy: EuStorageStrategy,
    private readonly asiaStrategy: AsiaStorageStrategy,
  ) {}

  async validateCompliance(dto: ComplianceCheckDto): Promise<ComplianceResultDto> {
    const policies = await this.policyRepo.find({
      where: { regionId: dto.region as unknown as string },
    });

    const violations: ComplianceViolationDto[] = [];
    const frameworks = policies.map((p) => p.policyType);

    const dataLocalized = await this.checkDataLocalization(dto.userId, dto.region);
    const encryptionEnabled = this.checkEncryption(dto.region);

    if (!dataLocalized) {
      violations.push({
        code: 'DATA_NOT_LOCALIZED',
        description: `User data is not stored in the assigned region ${dto.region}`,
        severity: 'critical',
        remediationAction: 'Trigger data migration to the correct region',
      });
    }

    if (!encryptionEnabled) {
      violations.push({
        code: 'ENCRYPTION_MISSING',
        description: 'Data encryption at rest is not enabled',
        severity: 'critical',
        remediationAction: 'Enable AES-256-GCM encryption for storage',
      });
    }

    if (dto.countryCode && dto.region === RegionCode.EU) {
      const isEu = this.euStrategy.isEeaCountry(dto.countryCode);
      if (!isEu) {
        violations.push({
          code: 'GDPR_INVALID_REGION',
          description: `Country ${dto.countryCode} should not be assigned to EU region`,
          severity: 'high',
          remediationAction: 'Re-route user to the appropriate region',
        });
      }
    }

    if (dto.countryCode && this.asiaStrategy.isChinaCslRequired(dto.countryCode)) {
      const correctRegion = dto.region === RegionCode.ASIA;
      if (!correctRegion) {
        violations.push({
          code: 'CHINA_CSL_VIOLATION',
          description: 'Chinese user data must be stored within China/ASIA region',
          severity: 'critical',
          remediationAction: 'Migrate data to ASIA region immediately',
        });
      }
    }

    const status =
      violations.length === 0
        ? ComplianceStatus.COMPLIANT
        : violations.some((v) => v.severity === 'critical')
        ? ComplianceStatus.NON_COMPLIANT
        : ComplianceStatus.PENDING_REVIEW;

    return {
      userId: dto.userId,
      region: dto.region,
      status,
      applicableFrameworks: frameworks,
      dataLocalized,
      encryptionEnabled,
      violations,
    };
  }

  async isMigrationAllowed(
    userId: string,
    sourceRegion: RegionCode,
    targetRegion: RegionCode,
  ): Promise<boolean> {
    const policies = await this.policyRepo.find({ where: { regionId: sourceRegion as unknown as string } });

    for (const policy of policies) {
      if (!policy.crossBorderTransferAllowed) {
        const allowed = policy.allowedTransferDestinations ?? [];
        if (!allowed.includes(targetRegion)) {
          this.logger.warn(
            `Policy ${policy.id} blocks transfer from ${sourceRegion} to ${targetRegion}`,
          );
          return false;
        }
      }
    }
    return true;
  }

  private async checkDataLocalization(_userId: string, _region: RegionCode): Promise<boolean> {
    // In production: query the storage index to verify user data key prefixes match the region.
    return true;
  }

  private checkEncryption(region: RegionCode): boolean {
    return [RegionCode.EU, RegionCode.US, RegionCode.ASIA, RegionCode.APAC].includes(region);
  }
}
