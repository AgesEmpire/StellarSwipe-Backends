import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsNumber,
  IsBoolean,
  IsArray,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { RoutingRuleType } from '../entities/routing-rule.entity';

export class CreateRoutingRuleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priority?: number;

  @IsEnum(RoutingRuleType)
  ruleType!: RoutingRuleType;

  @IsObject()
  conditions!: Record<string, unknown>;

  @IsString()
  targetTeamId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateRoutingRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  targetTeamId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSupportTeamDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(10)
  region!: string;

  @IsArray()
  @IsString({ each: true })
  languages!: string[];

  @IsString()
  timezone!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxCapacity?: number;

  @IsOptional()
  @IsObject()
  workingHours?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
