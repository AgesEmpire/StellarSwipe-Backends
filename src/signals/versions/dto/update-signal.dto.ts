import {
  IsOptional,
  IsNumber,
  IsPositive,
  IsBoolean,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateSignalDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  targetPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  stopLoss?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  takeProfit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  entryPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}

export class CopierApprovalDto {
  @IsBoolean()
  approved: boolean;

  // If true, any future updates to this signal are applied automatically
  @IsOptional()
  @IsBoolean()
  autoAdjust?: boolean;
}
