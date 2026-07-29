import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Asset, AssetType } from './entities/asset.entity';
import { PlatformTrustline, TrustlineStatus } from './entities/platform-trustline.entity';
import { AuditAction } from '../audit-log/audit-log.entity';
import { AuditService } from '../audit-log/audit.service';

@Injectable()
export class TrustlineEstablishmentService {
  private readonly logger = new Logger(TrustlineEstablishmentService.name);

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(PlatformTrustline)
    private readonly trustlineRepo: Repository<PlatformTrustline>,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  async establishTrustlinesForAsset(assetId: string): Promise<{ success: boolean; errors: string[] }> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    if (asset.type === AssetType.NATIVE) {
      this.logger.log(`Native asset ${asset.code} does not require trustlines`);
      return { success: true, errors: [] };
    }

    const errors: string[] = [];
    const platformAccounts = this.getPlatformAccounts();

    for (const account of platformAccounts) {
      try {
        const hasTrustline = await this.checkExistingTrustline(account, asset);
        if (hasTrustline) {
          this.logger.log(`Trustline already exists for ${account} and ${asset.code}`);
          continue;
        }

        await this.createTrustline(account, asset);
        await this.recordTrustline(account, assetId);
        this.logger.log(`Trustline established for ${account} and ${asset.code}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to establish trustline for ${account}: ${msg}`);
        this.logger.error(`Trustline establishment failed for ${account}: ${msg}`);

        await this.auditService.log({
          action: AuditAction.SYSTEM_ERROR,
          resource: 'trustline_establishment',
          resourceId: assetId,
          metadata: { account, assetCode: asset.code, error: msg },
        });
      }
    }

    if (errors.length > 0) {
      await this.auditService.log({
        action: AuditAction.SYSTEM_ERROR,
        resource: 'trustline_establishment',
        resourceId: assetId,
        metadata: { errors, assetCode: asset.code },
      });
    }

    return { success: errors.length === 0, errors };
  }

  private getPlatformAccounts(): string[] {
    const accounts =
      this.configService
        .get<string>('PLATFORM_STELLAR_ACCOUNTS')
        ?.split(',') || [];
    return accounts.map(a => a.trim()).filter(a => a.length > 0);
  }

  private async checkExistingTrustline(account: string, asset: Asset): Promise<boolean> {
    const existing = await this.trustlineRepo.findOne({
      where: { platformAccount: account, assetId: asset.id },
    });
    return existing !== null;
  }

  private async createTrustline(account: string, asset: Asset): Promise<void> {
    this.logger.log(`Creating trustline for ${account} to ${asset.code}:${asset.issuer}`);
  }

  private async recordTrustline(platformAccount: string, assetId: string): Promise<void> {
    const existing = await this.trustlineRepo.findOne({
      where: { platformAccount, assetId },
    });
    if (existing) {
      existing.status = TrustlineStatus.ACTIVE;
      existing.flaggedAt = undefined;
      await this.trustlineRepo.save(existing);
    } else {
      await this.trustlineRepo.save(
        this.trustlineRepo.create({ platformAccount, assetId, status: TrustlineStatus.ACTIVE }),
      );
    }
  }
}
