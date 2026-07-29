import { IsString } from 'class-validator';

export class EvaluateFlagDto {
  @IsString()
  flagName!: string;

  @IsString()
  userId!: string;
}

export interface FlagEvaluationResult {
  enabled: boolean;
  variant?: string;
  /** True when this result is a safe-default fallback rather than a real evaluation (flag missing, evaluation error, environment/tenant mismatch). */
  fallback?: boolean;
  reason?: string;
}

export interface FlagEvaluationContext {
  tenantId?: string;
  environment?: string;
}
