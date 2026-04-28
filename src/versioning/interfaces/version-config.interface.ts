export enum VersionStatus {
  SUPPORTED = 'supported',
  DEPRECATED = 'deprecated',
  SUNSET = 'sunset',
  EXPERIMENTAL = 'experimental',
}

export interface VersionMetadata {
  status: VersionStatus;
  sunsetDate?: string;
  successorVersion?: string;
  description?: string;
}

export interface VersionConfig {
  defaultVersion: string;
  versions: Record<string, VersionMetadata>;
}
