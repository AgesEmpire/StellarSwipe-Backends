import { Injectable, Logger } from '@nestjs/common';
import { VersionConfig, VersionMetadata, VersionStatus } from './interfaces/version-config.interface';

@Injectable()
export class VersionManagerService {
  private readonly logger = new Logger(VersionManagerService.name);
  private readonly config: VersionConfig = {
    defaultVersion: '1',
    versions: {
      '1': {
        status: VersionStatus.DEPRECATED,
        sunsetDate: '2025-12-31',
        successorVersion: '2',
        description: 'Legacy API version. Please migrate to v2.',
      },
      '2': {
        status: VersionStatus.SUPPORTED,
        description: 'Current stable version.',
      },
    },
  };

  /**
   * Resolve the version metadata for a given version string.
   */
  getVersionMetadata(version: string): VersionMetadata | null {
    return this.config.versions[version] || null;
  }

  /**
   * Check if a version is supported.
   */
  isSupported(version: string): boolean {
    const meta = this.getVersionMetadata(version);
    return !!meta && meta.status !== VersionStatus.SUNSET;
  }

  /**
   * Check if a version is deprecated.
   */
  isDeprecated(version: string): boolean {
    const meta = this.getVersionMetadata(version);
    return !!meta && meta.status === VersionStatus.DEPRECATED;
  }

  /**
   * Get the default version.
   */
  getDefaultVersion(): string {
    return this.config.defaultVersion;
  }

  /**
   * Get all supported versions.
   */
  getSupportedVersions(): string[] {
    return Object.keys(this.config.versions).filter((v) => this.isSupported(v));
  }
}
