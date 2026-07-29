import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  Length,
} from 'class-validator';

export class EvaluateTradeDto {
  @IsString()
  userId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @Length(1, 50)
  asset!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  counterAsset?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;
}

export class TradeEligibilityResultDto {
  eligible!: boolean;
  outcome!: 'approved' | 'rejected';
  /** Reasons for rejection (empty array when approved). */
  reasons!: string[];
  /** Detailed per-rule breakdown. */
  ruleResults!: {
    ruleId: string;
    ruleName: string;
    passed: boolean;
    reason?: string;
  }[];
  /** Persisted audit record ID. */
  decisionId!: string;
}
