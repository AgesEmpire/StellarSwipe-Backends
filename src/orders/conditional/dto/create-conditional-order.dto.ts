import {
  IsUUID,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
  ValidateNested,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConditionGroupDto } from './order-condition.dto';

export enum ConditionalOrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum ConditionalOrderStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  TRIGGERED = 'TRIGGERED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

export class CreateConditionalOrderDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({ enum: ConditionalOrderSide })
  @IsEnum(ConditionalOrderSide)
  side!: ConditionalOrderSide;

  @ApiProperty({ description: 'Asset code to sell' })
  @IsString()
  @IsNotEmpty()
  sellingAssetCode!: string;

  @ApiPropertyOptional({ description: 'Selling asset issuer (omit for XLM)' })
  @IsOptional()
  @IsString()
  sellingAssetIssuer?: string;

  @ApiProperty({ description: 'Asset code to buy' })
  @IsString()
  @IsNotEmpty()
  buyingAssetCode!: string;

  @ApiPropertyOptional({ description: 'Buying asset issuer (omit for XLM)' })
  @IsOptional()
  @IsString()
  buyingAssetIssuer?: string;

  @ApiProperty({ description: 'Order amount' })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({
    description: 'Limit price (null = market order when triggered)',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  limitPrice?: number;

  @ApiPropertyOptional({
    description: 'Slippage tolerance percentage (0-10)',
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  slippageTolerance?: number = 1;

  @ApiProperty({ type: [ConditionGroupDto], description: 'Conditions that must be met to trigger the order' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionGroupDto)
  conditionGroups!: ConditionGroupDto[];

  @ApiPropertyOptional({ description: 'ISO expiry date for the conditional order' })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class UpdateConditionalOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive()
  limitPrice?: number;

  @ApiPropertyOptional({ type: [ConditionGroupDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionGroupDto)
  conditionGroups?: ConditionGroupDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
