import { SetMetadata } from '@nestjs/common';

export const MAX_CALL_DEPTH_KEY = 'max_call_depth';

export interface MaxCallDepthConfig {
  maxDepth: number;
  endpoint?: string;
  onViolation?: 'reject' | 'warn';
}

export const MaxCallDepth = (config: MaxCallDepthConfig) =>
  SetMetadata(MAX_CALL_DEPTH_KEY, config);