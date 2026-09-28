import {
  IsUUID,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TradeSide } from '../../trades/entities/trade.entity';

export class PlaceLimitOrderDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() userId!: string;
  @ApiProperty() @IsUUID() @IsNotEmpty() signalId!: string;
  @ApiProperty({ enum: TradeSide }) @IsEnum(TradeSide) side!: TradeSide;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 8 }) @IsPositive() amount!: number;
  @ApiProperty({ description: 'Maximum price willing to pay (BUY) or minimum to accept (SELL)' })
  @IsNumber({ maxDecimalPlaces: 8 }) @IsPositive() limitPrice!: number;
  @ApiPropertyOptional() @IsString() @IsOptional() walletAddress?: string;
  @ApiPropertyOptional({ description: 'Max allowed slippage %', default: 1 })
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) @Max(10)
  slippageTolerance?: number = 1;
}

export class LimitOrderStatusDto {
  @ApiProperty() id!: string;
  @ApiProperty() status!: 'pending' | 'filled' | 'rejected' | 'expired';
  @ApiPropertyOptional() transactionHash?: string;
  @ApiPropertyOptional() executedPrice?: string;
  @ApiPropertyOptional() feeAmount?: string;
  @ApiPropertyOptional() error?: string;
  @ApiProperty() createdAt!: Date;
}
