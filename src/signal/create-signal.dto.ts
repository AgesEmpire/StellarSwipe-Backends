import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  Max,
  MinLength,
  Matches,
  IsPositive,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum SignalAction {
  BUY = 'BUY',
  SELL = 'SELL',
}

export class CreateSignalDto {
  @ApiProperty({
    description: 'Trading pair in format BASE/QUOTE',
    example: 'USDC/XLM',
  })
  @IsString()
  @Matches(/^[A-Z]{3,10}\/[A-Z]{3,10}$/, {
    message: 'Asset pair must be in format BASE/QUOTE (e.g., USDC/XLM)',
  })
  assetPair: string;

  @ApiProperty({
    description: 'Signal action type',
    enum: SignalAction,
    example: SignalAction.BUY,
  })
  @IsEnum(SignalAction, {
    message: 'Action must be either BUY or SELL',
  })
  action: SignalAction;

  @ApiProperty({
    description: 'Entry price for the trade',
    example: 0.12,
  })
  @IsNumber()
  @IsPositive({ message: 'Entry price must be positive' })
  entryPrice: number;

  @ApiProperty({
    description: 'Target price for the trade',
    example: 0.15,
  })
  @IsNumber()
  @IsPositive({ message: 'Target price must be positive' })
  targetPrice: number;

  @ApiProperty({
    description: 'Stop loss price',
    example: 0.11,
  })
  @IsNumber()
  @IsPositive({ message: 'Stop loss must be positive' })
  stopLoss: number;

  @ApiProperty({
    description: 'Trading rationale (minimum 50 characters)',
    example:
      'Strong bullish momentum with RSI oversold. Breaking resistance at 0.12 with high volume.',
  })
  @IsString()
  @MinLength(50, {
    message: 'Rationale must be at least 50 characters long',
  })
  rationale: string;

  @ApiProperty({
    description: 'Signal expiration time in hours (default: 24, max: 168)',
    example: 24,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Expiration must be at least 1 hour' })
  @Max(168, { message: 'Expiration cannot exceed 168 hours (7 days)' })
  expiresIn?: number;
}