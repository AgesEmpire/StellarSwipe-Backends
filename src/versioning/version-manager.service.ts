import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { VersionConfig, VersionMetadata, VersionStatus } from './interfaces/version-config.interface';

export const VERSION_CONFIG = 'VERSION_CONFIG';

const DEFAULT_CONFIG: VersionConfig = {
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

export interface VersionInfo extends VersionMetadata {
  version: string;
  effectiveStatus: VersionStatus;
}

@Injectable()
export class VersionManagerService {
  private readonly logger = new Logger(VersionManagerService.name);
  private readonly config: VersionConfig;

  constructor(@Optional() @Inject(VERSION_CONFIG) config?: VersionConfig) {
    this.config = VersionManagerService.applyEnvOverrides(config ?? DEFAULT_CONFIG);
  }

  /**
   * Deprecation timing is configurable per environment:
   *   API_VERSION_CONFIG            full JSON VersionConfig override
   *   API_DEFAULT_VERSION           default version
   *   API_V<n>_STATUS               supported | deprecated | sunset | experimental
   *   API_V<n>_SUNSET_DATE          ISO date after which the version is sunset
   *   API_V<n>_SUCCESSOR_VERSION    successor advertised in Link header
   */
  private static applyEnvOverrides(base: VersionConfig): VersionConfig {
    const env = process.env;
    let config: VersionConfig = JSON.parse(JSON.stringify(base));

    if (env.API_VERSION_CONFIG) {
      try {
        config = JSON.parse(env.API_VERSION_CONFIG);
      } catch {
        new Logger(VersionManagerService.name).error('Invalid API_VERSION_CONFIG JSON; using defaults');
      }
    }
    if (env.API_DEFAULT_VERSION) config.defaultVersion = env.API_DEFAULT_VERSION;

    for (const [version, meta] of Object.entries(config.versions)) {
      const prefix = `API_V${version}_`;
      const status = env[`${prefix}STATUS`] as VersionStatus | undefined;
      if (status && Object.values(VersionStatus).includes(status)) meta.status = status;
      if (env[`${prefix}SUNSET_DATE`]) meta.sunsetDate = env[`${prefix}SUNSET_DATE`];
      if (env[`${prefix}SUCCESSOR_VERSION`]) meta.successorVersion = env[`${prefix}SUCCESSOR_VERSION`];
    }
    return config;
  }

  /**
   * Resolve the version metadata for a given version string.
   */
  getVersionMetadata(version: string): VersionMetadata | null {
    return this.config.versions[version] || null;
  }

  /**
   * Status after applying the sunset date: a deprecated version whose sunset
   * date has passed is treated as sunset.
   */
  getEffectiveStatus(version: string, now: Date = new Date()): VersionStatus | null {
    const meta = this.getVersionMetadata(version);
    if (!meta) return null;
    if (meta.sunsetDate && meta.status !== VersionStatus.SUNSET) {
      const sunset = new Date(meta.sunsetDate);
      if (!isNaN(sunset.getTime()) && now >= sunset) return VersionStatus.SUNSET;
    }
    return meta.status;
  }

  /**
   * Whether the version exists in the config (regardless of status).
   */
  isKnown(version: string): boolean {
    return !!this.getVersionMetadata(version);
  }

  /**
   * Check if a version is supported.
   */
  isSupported(version: string, now?: Date): boolean {
    const status = this.getEffectiveStatus(version, now);
    return !!status && status !== VersionStatus.SUNSET;
  }

  /**
   * Check if a version is sunset (known but past removal).
   */
  isSunset(version: string, now?: Date): boolean {
    return this.getEffectiveStatus(version, now) === VersionStatus.SUNSET;
  }

  /**
   * Check if a version is deprecated.
   */
  isDeprecated(version: string, now?: Date): boolean {
    return this.getEffectiveStatus(version, now) === VersionStatus.DEPRECATED;
  }

  /**
   * Get the default version. Falls back to the newest supported version once
   * the configured default has been sunset.
   */
  getDefaultVersion(): string {
    if (this.isSupported(this.config.defaultVersion)) return this.config.defaultVersion;
    const supported = this.getSupportedVersions().sort((a, b) => Number(b) - Number(a));
    return supported[0] ?? this.config.defaultVersion;
  }

  /**
   * Get all supported versions.
   */
  getSupportedVersions(now?: Date): string[] {
    return Object.keys(this.config.versions).filter((v) => this.isSupported(v, now));
  }

  /**
   * Consistent version metadata for docs and responses.
   */
  getAllVersionInfo(now?: Date): VersionInfo[] {
    return Object.entries(this.config.versions).map(([version, meta]) => ({
      version,
      ...meta,
      effectiveStatus: this.getEffectiveStatus(version, now)!,
    }));
  }
}
