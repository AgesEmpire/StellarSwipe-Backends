import { IsUUID, IsOptional, IsNumberString, IsNumber, Min } from 'class-validator';

export class SetRiskLevelsDto {
  @IsUUID()
  tradeId!: string;

  @IsOptional()
  @IsNumberString()
  stopLossPrice?: string;

  @IsOptional()
  @IsNumberString()
  takeProfitPrice?: string;
}

export class RiskConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultStopLossPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultTakeProfitPercent?: number;
}
