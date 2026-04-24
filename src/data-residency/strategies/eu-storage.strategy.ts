import { Injectable, Logger } from '@nestjs/common';
import { RegionCode } from '../entities/data-region.entity';

export interface StorageStrategy {
  readonly regionCode: RegionCode;
  getStorageEndpoint(): string;
  getEncryptionConfig(): EncryptionConfig;
  getAllowedTransferDestinations(): RegionCode[];
  supportsDataType(dataType: string): boolean;
}

export interface EncryptionConfig {
  algorithm: string;
  keySize: number;
  atRestEncryption: boolean;
  inTransitEncryption: boolean;
}

@Injectable()
export class EuStorageStrategy implements StorageStrategy {
  private readonly logger = new Logger(EuStorageStrategy.name);

  readonly regionCode = RegionCode.EU;

  private static readonly EU_MEMBER_STATES = [
    'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI',
    'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
    'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  ];

  private static readonly EEA_COUNTRIES = [
    ...EuStorageStrategy.EU_MEMBER_STATES,
    'IS', 'LI', 'NO',
  ];

  getStorageEndpoint(): string {
    return process.env.EU_STORAGE_ENDPOINT ?? 'https://eu-storage.stellarswipe.internal';
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
    // GDPR Article 45: transfers only to countries with adequacy decisions
    return [RegionCode.EU];
  }

  supportsDataType(dataType: string): boolean {
    // EU/GDPR handles all personal data types
    const supported = ['personal', 'financial', 'biometric', 'health', 'transaction'];
    return supported.includes(dataType.toLowerCase());
  }

  isEuMemberState(countryCode: string): boolean {
    return EuStorageStrategy.EU_MEMBER_STATES.includes(countryCode.toUpperCase());
  }

  isEeaCountry(countryCode: string): boolean {
    return EuStorageStrategy.EEA_COUNTRIES.includes(countryCode.toUpperCase());
  }

  getRetentionPolicy(): { defaultDays: number; maxDays: number } {
    return { defaultDays: 730, maxDays: 1825 };
  }

  getRightToErasureSupported(): boolean {
    return true;
  }

  getDataPortabilitySupported(): boolean {
    return true;
  }
}
