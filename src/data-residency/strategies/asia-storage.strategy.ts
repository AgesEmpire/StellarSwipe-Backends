import { Injectable, Logger } from '@nestjs/common';
import { RegionCode } from '../entities/data-region.entity';
import { EncryptionConfig, StorageStrategy } from './eu-storage.strategy';

export enum AsiaSubRegion {
  CHINA = 'CN',
  JAPAN = 'JP',
  SOUTH_KOREA = 'KR',
  SINGAPORE = 'SG',
  INDIA = 'IN',
  AUSTRALIA = 'AU',
  OTHER = 'OTHER',
}

@Injectable()
export class AsiaStorageStrategy implements StorageStrategy {
  private readonly logger = new Logger(AsiaStorageStrategy.name);

  readonly regionCode = RegionCode.ASIA;

  private static readonly CHINA_CSL_COUNTRIES = ['CN', 'HK', 'MO'];
  private static readonly PDPA_COUNTRIES = ['TH', 'SG', 'MY', 'PH', 'ID', 'VN'];
  private static readonly APPI_COUNTRIES = ['JP'];
  private static readonly PIPA_COUNTRIES = ['KR'];

  getStorageEndpoint(): string {
    return process.env.ASIA_STORAGE_ENDPOINT ?? 'https://asia-storage.stellarswipe.internal';
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
    // Cross-border transfers vary by country; default to same-region only
    return [RegionCode.ASIA];
  }

  supportsDataType(dataType: string): boolean {
    const supported = ['personal', 'financial', 'transaction'];
    return supported.includes(dataType.toLowerCase());
  }

  getSubRegion(countryCode: string): AsiaSubRegion {
    const upper = countryCode.toUpperCase();
    if (AsiaStorageStrategy.CHINA_CSL_COUNTRIES.includes(upper)) return AsiaSubRegion.CHINA;
    if (upper === 'JP') return AsiaSubRegion.JAPAN;
    if (upper === 'KR') return AsiaSubRegion.SOUTH_KOREA;
    if (upper === 'SG') return AsiaSubRegion.SINGAPORE;
    if (upper === 'IN') return AsiaSubRegion.INDIA;
    if (upper === 'AU') return AsiaSubRegion.AUSTRALIA;
    return AsiaSubRegion.OTHER;
  }

  getApplicableFramework(countryCode: string): string {
    const upper = countryCode.toUpperCase();
    if (AsiaStorageStrategy.CHINA_CSL_COUNTRIES.includes(upper)) return 'CHINA_CSL';
    if (AsiaStorageStrategy.PDPA_COUNTRIES.includes(upper)) return 'PDPA';
    if (AsiaStorageStrategy.APPI_COUNTRIES.includes(upper)) return 'APPI';
    if (AsiaStorageStrategy.PIPA_COUNTRIES.includes(upper)) return 'PIPA';
    return 'LOCAL';
  }

  isChinaCslRequired(countryCode: string): boolean {
    return AsiaStorageStrategy.CHINA_CSL_COUNTRIES.includes(countryCode.toUpperCase());
  }

  getRetentionPolicy(countryCode: string): { defaultDays: number; maxDays: number } {
    if (this.isChinaCslRequired(countryCode)) {
      // China CSL requires minimum 3 years for some data categories
      return { defaultDays: 1095, maxDays: 3650 };
    }
    return { defaultDays: 730, maxDays: 1825 };
  }

  getChinaEndpoint(): string {
    return process.env.CHINA_STORAGE_ENDPOINT ?? 'https://cn-storage.stellarswipe.internal';
  }
}
