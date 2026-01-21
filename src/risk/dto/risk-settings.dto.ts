import { IsNumber, IsBoolean, IsOptional, Min, Max } from 'class-validator';

export class CreateRiskSettingsDto {
  @IsNumber()
  @Min(1)
  @Max(50)
  maxOpenPositions: number = 10;

  @IsNumber()
  @Min(1)
  @Max(100)
  maxExposurePercentage: number = 50;

  @IsBoolean()
  requireStopLoss: boolean = true;

  @IsNumber()
  @Min(1)
  @Max(100)
  minStopLossPercentage: number = 5;

  @IsNumber()
  @Min(1)
  @Max(100)
  maxStopLossPercentage: number = 20;
}

export class UpdateRiskSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  maxOpenPositions?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  maxExposurePercentage?: number;

  @IsOptional()
  @IsBoolean()
  requireStopLoss?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  minStopLossPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  maxStopLossPercentage?: number;
}
