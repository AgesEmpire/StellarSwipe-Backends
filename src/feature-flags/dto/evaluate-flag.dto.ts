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
}
