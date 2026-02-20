import {
  IsString,
  IsEnum,
  IsNumber,
  IsArray,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  MaxLength,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TierLevel } from '../entities/subscription-tier.entity';

export class CreateTierDto {
  @ApiProperty({ example: 'Premium Signals', description: 'Human-readable tier name' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Exclusive access to high-confidence signals' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: TierLevel,
    example: TierLevel.BASIC,
    description: 'Tier classification level',
  })
  @IsEnum(TierLevel)
  level!: TierLevel;

  @ApiProperty({
    example: 10,
    description: 'Monthly price in USDC (0 for FREE tier)',
  })
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(0)
  @Max(10000)
  price!: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Maximum signals per day (omit or null for unlimited)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  signalLimit?: number | null;

  @ApiProperty({
    example: ['Daily market analysis', 'Priority support', 'Unlimited signals'],
    description: 'List of benefits included in this tier',
  })
  @IsArray()
  @IsString({ each: true })
  benefits!: string[];
}

export class UpdateTierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: ['New benefit'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benefits?: string[];

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  signalLimit?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Stop accepting new subscribers without cancelling existing ones' })
  @IsOptional()
  @IsBoolean()
  acceptingNewSubscribers?: boolean;
}
