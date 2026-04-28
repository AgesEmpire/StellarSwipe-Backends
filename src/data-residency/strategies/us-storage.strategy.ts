import { Injectable, Logger } from '@nestjs/common';
import { RegionCode } from '../entities/data-region.entity';
import { EncryptionConfig, StorageStrategy } from './eu-storage.strategy';

@Injectable()
export class UsStorageStrategy implements StorageStrategy {
  private readonly logger = new Logger(UsStorageStrategy.name);

  readonly regionCode = RegionCode.US;

  private static readonly US_TERRITORIES = [
    'US', 'PR', 'GU', 'VI', 'MP', 'AS',
  ];

  getStorageEndpoint(): string {
    return process.env.US_STORAGE_ENDPOINT ?? 'https://us-storage.stellarswipe.internal';
  }

  getEncryptionConfig(): EncryptionConfig {
    return {
      algorithm: 'AES-256-GCM',
      keySize: 256,
      atRestEncryption: true,
      inTransitEncryption: true,
    };
  }

  getAllowedTransferDestinations(): RegionCode[] {
    // CCPA allows transfers with contractual safeguards; EU adequacy covers EU transfers
    return [RegionCode.US, RegionCode.EU];
  }

  supportsDataType(dataType: string): boolean {
    const supported = ['personal', 'financial', 'transaction', 'behavioral'];
    return supported.includes(dataType.toLowerCase());
  }

  isUsTerritory(countryCode: string): boolean {
    return UsStorageStrategy.US_TERRITORIES.includes(countryCode.toUpperCase());
  }

  getCcpaApplicable(state: string): boolean {
    // Currently only California has CCPA; other states have their own laws
    const ccpaStates = ['CA', 'VA', 'CO', 'CT', 'UT'];
    return ccpaStates.includes(state.toUpperCase());
  }

  getRetentionPolicy(): { defaultDays: number; maxDays: number } {
    return { defaultDays: 365, maxDays: 2555 };
  }

  getOptOutRightSupported(): boolean {
    return true;
  }

  getDataDeletionSupported(): boolean {
    return true;
  }
}
