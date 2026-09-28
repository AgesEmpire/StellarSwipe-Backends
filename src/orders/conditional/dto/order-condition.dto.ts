import { IsEnum, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ConditionType {
  PRICE_ABOVE = 'PRICE_ABOVE',
  PRICE_BELOW = 'PRICE_BELOW',
  PRICE_BETWEEN = 'PRICE_BETWEEN',
  TIME_BASED = 'TIME_BASED',
  VOLUME_SPIKE = 'VOLUME_SPIKE',
  SIGNAL_TRIGGER = 'SIGNAL_TRIGGER',
}

export enum ConditionOperator {
  AND = 'AND',
  OR = 'OR',
}

export class OrderConditionDto {
  @ApiProperty({ enum: ConditionType })
  @IsEnum(ConditionType)
  type!: ConditionType;

  @ApiProperty({ description: 'Primary threshold value (e.g. trigger price)' })
  @IsNumber()
  @Min(0)
  value!: number;

  @ApiPropertyOptional({
    description: 'Secondary threshold (required for PRICE_BETWEEN, upper bound)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  valueMax?: number;

  @ApiPropertyOptional({ description: 'Asset/code the condition applies to' })
  @IsOptional()
  @IsString()
  assetCode?: string;

  @ApiPropertyOptional({ description: 'Asset issuer if not native XLM' })
  @IsOptional()
  @IsString()
  assetIssuer?: string;
}

export class ConditionGroupDto {
  @ApiProperty({ type: [OrderConditionDto] })
  conditions!: OrderConditionDto[];

  @ApiProperty({ enum: ConditionOperator, default: ConditionOperator.AND })
  @IsEnum(ConditionOperator)
  @IsOptional()
  operator?: ConditionOperator = ConditionOperator.AND;
}
