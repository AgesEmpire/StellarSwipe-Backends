import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CheckTradeEligibilityDto {
  @IsString()
  userId: string;

  @IsString()
  baseAsset: string;

  @IsString()
  counterAsset: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsOptional()
  countryCode?: string;
}

export interface TradeEligibilityResult {
  eligible: boolean;
  reasons: string[];
  checkedRules: string[];
  decidedAt: string;
}
