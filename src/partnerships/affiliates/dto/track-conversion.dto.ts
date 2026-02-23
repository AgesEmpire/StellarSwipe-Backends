import { IsString, IsNumber, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ConversionType } from '../entities/affiliate-conversion.entity';

export class TrackConversionDto {
  @IsString()
  affiliateCode: string;

  @IsString()
  referredUserId: string;

  @IsEnum(ConversionType)
  conversionType: ConversionType;

  @IsNumber()
  conversionValue: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
