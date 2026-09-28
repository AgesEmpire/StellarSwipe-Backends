import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsStellarPrecision } from '../../common/decorators/is-stellar-precision.decorator';
import { TradeSide } from '../entities/trade.entity';

export class BatchOrderItemDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() userId!: string;
  @ApiProperty() @IsUUID() @IsNotEmpty() signalId!: string;
  @ApiProperty({ enum: TradeSide }) @IsEnum(TradeSide) side!: TradeSide;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 8 }) @IsPositive() @IsStellarPrecision() amount!: number;
  @ApiPropertyOptional() @IsNumber({ maxDecimalPlaces: 8 }) @IsOptional() @IsPositive() @IsStellarPrecision() stopLossPrice?: number;
  @ApiPropertyOptional() @IsNumber({ maxDecimalPlaces: 8 }) @IsOptional() @IsPositive() @IsStellarPrecision() takeProfitPrice?: number;
  @ApiPropertyOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) @Max(100) slippageTolerance?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() walletAddress?: string;
}

export class BatchOrderDto {
  @ApiProperty({ type: [BatchOrderItemDto], description: 'Ordered list of trade requests' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchOrderItemDto)
  orders!: BatchOrderItemDto[];
}

export class BatchOrderItemSuccess {
  @ApiProperty() index!: number;
  @ApiProperty() status!: 'accepted';
  @ApiProperty() result!: unknown;
}

export class BatchOrderItemFailure {
  @ApiProperty() index!: number;
  @ApiProperty() status!: 'rejected';
  @ApiProperty({ type: [String] }) errors!: string[];
}

export class BatchOrderResponseDto {
  @ApiProperty({ type: [BatchOrderItemSuccess] }) accepted!: BatchOrderItemSuccess[];
  @ApiProperty({ type: [BatchOrderItemFailure] }) rejected!: BatchOrderItemFailure[];
  @ApiProperty() acceptedCount!: number;
  @ApiProperty() rejectedCount!: number;
}
