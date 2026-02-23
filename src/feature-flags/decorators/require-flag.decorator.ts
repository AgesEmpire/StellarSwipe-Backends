import { SetMetadata } from '@nestjs/common';

export const FEATURE_FLAG_KEY = 'featureFlag';
export const RequireFlag = (flagName: string) => SetMetadata(FEATURE_FLAG_KEY, flagName);
