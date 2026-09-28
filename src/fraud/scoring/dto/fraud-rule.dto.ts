import { IsString, IsEnum, IsInt, IsOptional, IsBoolean, MaxLength, Min, Max } from 'class-validator';
import { FraudRuleType } from '../entities/fraud-rule.entity';

export class CreateFraudRuleDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsEnum(FraudRuleType)
  ruleType!: FraudRuleType;

  @IsInt()
  @Min(0)
  @Max(100)
  scoreWeight!: number;

  @IsOptional()
  conditions?: Record<string, any>;
}

export class ScoreTransactionDto {
  @IsString()
  transactionId!: string;

  @IsString()
  userId!: string;

  @IsInt()
  @Min(0)
  amount!: number;

  @IsOptional()
  metadata?: Record<string, any>;
}
