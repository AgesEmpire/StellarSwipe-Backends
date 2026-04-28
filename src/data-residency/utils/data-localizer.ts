import { Injectable, Logger } from '@nestjs/common';
import { RegionCode } from '../entities/data-region.entity';

export interface LocalizationResult {
  userId: string;
  sourceRegion: RegionCode;
  targetRegion: RegionCode;
  dataKeys: string[];
  success: boolean;
  errors: string[];
  processedAt: Date;
}

export interface LocalizationOptions {
  dryRun?: boolean;
  encryptBeforeTransfer?: boolean;
  deleteSourceAfterTransfer?: boolean;
}

@Injectable()
export class DataLocalizer {
  private readonly logger = new Logger(DataLocalizer.name);

  async localizeUserData(
    userId: string,
    sourceRegion: RegionCode,
    targetRegion: RegionCode,
    dataKeys: string[],
    options: LocalizationOptions = {},
  ): Promise<LocalizationResult> {
    const result: LocalizationResult = {
      userId,
      sourceRegion,
      targetRegion,
      dataKeys,
      success: false,
      errors: [],
      processedAt: new Date(),
    };

    if (sourceRegion === targetRegion) {
      result.success = true;
      return result;
    }

    try {
      this.logger.log(
        `Localizing data for user ${userId} from ${sourceRegion} to ${targetRegion}`,
      );

      if (!options.dryRun) {
        await this.transferData(userId, sourceRegion, targetRegion, dataKeys, options);

        if (options.deleteSourceAfterTransfer) {
          await this.deleteSourceData(userId, sourceRegion, dataKeys);
        }
      }

      result.success = true;
      this.logger.log(`Data localization completed for user ${userId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      this.logger.error(`Data localization failed for user ${userId}: ${message}`);
    }

    return result;
  }

  private async transferData(
    userId: string,
    sourceRegion: RegionCode,
    targetRegion: RegionCode,
    dataKeys: string[],
    options: LocalizationOptions,
  ): Promise<void> {
    // Placeholder: in production this calls the storage service APIs for source/target regions.
    // If options.encryptBeforeTransfer is true, data is encrypted with target region's key
    // before being written to the target storage endpoint.
    this.logger.debug(
      `Transferring ${dataKeys.length} keys for user ${userId} ` +
      `from ${sourceRegion} → ${targetRegion} (encrypt=${options.encryptBeforeTransfer})`,
    );
  }

  private async deleteSourceData(
    userId: string,
    sourceRegion: RegionCode,
    dataKeys: string[],
  ): Promise<void> {
    this.logger.debug(
      `Deleting ${dataKeys.length} source keys for user ${userId} in ${sourceRegion}`,
    );
  }

  buildStorageKey(userId: string, region: RegionCode, dataType: string): string {
    return `${region.toLowerCase()}/${userId}/${dataType}`;
  }

  extractRegionFromKey(storageKey: string): RegionCode | null {
    const prefix = storageKey.split('/')[0]?.toUpperCase();
    const valid = Object.values(RegionCode);
    return valid.includes(prefix as RegionCode) ? (prefix as RegionCode) : null;
  }
}
