import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TradeSide } from '../../trades/entities/trade.entity';

export class AddTransactionDto {
  @ApiProperty({ enum: TradeSide, description: 'Trade side: buy or sell' })
  @IsEnum(TradeSide)
  side!: TradeSide;

  @ApiProperty({ description: 'Base asset code, e.g. XLM' })
  @IsString()
  @IsNotEmpty()
  baseAsset!: string;

  @ApiProperty({ description: 'Counter asset code, e.g. USDC' })
  @IsString()
  @IsNotEmpty()
  counterAsset!: string;

  @ApiProperty({ description: 'Trade amount' })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ description: 'Entry price' })
  @IsNumber()
  @IsPositive()
  entryPrice!: number;

  @ApiPropertyOptional({ description: 'Signal ID associated with this trade' })
  @IsOptional()
  @IsUUID()
  signalId?: string;

  @ApiPropertyOptional({ description: 'Fee amount' })
  @IsOptional()
  @IsNumber()
  feeAmount?: number;
}
