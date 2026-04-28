import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const DEPRECATED_KEY = 'isDeprecated';
export const DEPRECATION_METADATA_KEY = 'deprecationMetadata';

export interface DeprecationOptions {
  sunsetDate: string;
  successorVersion?: string;
  reason?: string;
}

/**
 * Decorator to mark an endpoint as deprecated.
 */
export const Deprecated = (options: DeprecationOptions): CustomDecorator => {
  return (target: object, key?: string | symbol, descriptor?: any) => {
    SetMetadata(DEPRECATED_KEY, true)(target, key as string, descriptor);
    SetMetadata(DEPRECATION_METADATA_KEY, options)(target, key as string, descriptor);
  };
};
