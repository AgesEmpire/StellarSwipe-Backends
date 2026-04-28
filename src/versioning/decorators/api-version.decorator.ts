import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const API_VERSION_KEY = 'apiVersion';

/**
 * Decorator to specify the API version for a controller or handler.
 */
export const ApiVersion = (version: string): CustomDecorator => SetMetadata(API_VERSION_KEY, version);
