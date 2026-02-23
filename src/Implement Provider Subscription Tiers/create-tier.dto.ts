import {
  IsString,
  IsNumber,
  IsArray,
  IsOptional,
  IsBoolean,
  Min,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTierDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  benefits: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  signalLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateTierDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benefits?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  signalLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
