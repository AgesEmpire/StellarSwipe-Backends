import { SetMetadata } from '@nestjs/common';

export const MINIMUM_SDK_VERSION_KEY = 'minimum_sdk_version';

export enum MissingHeaderBehavior {
  REJECT = 'reject',
  WARN = 'warn',
  ALLOW = 'allow',
}

export interface MinimumSdkVersionConfig {
  version: string; // e.g., "1.2.3"
  missingHeaderBehavior?: MissingHeaderBehavior; // defaults to WARN
  headerName?: string; // defaults to "X-Client-SDK-Version"
}

export const MinimumSdkVersion = (config: MinimumSdkVersionConfig) =>
  SetMetadata(MINIMUM_SDK_VERSION_KEY, {
    version: config.version,
    missingHeaderBehavior: config.missingHeaderBehavior ?? MissingHeaderBehavior.WARN,
    headerName: config.headerName ?? 'X-Client-SDK-Version',
  });
