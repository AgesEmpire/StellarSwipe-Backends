import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsNumber,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { TargetType } from '../entities/campaign-target.entity';

export class CreateCampaignTargetDto {
  @IsEnum(TargetType)
  targetType!: TargetType;

  @IsString()
  @MaxLength(100)
  targetValue!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  weight?: number;

  @IsOptional()
  @IsObject()
  criteria?: Record<string, unknown>;
}
