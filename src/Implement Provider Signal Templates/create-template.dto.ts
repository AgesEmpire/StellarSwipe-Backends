import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsObject,
  ValidateNested,
  MaxLength,
  ArrayNotEmpty,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TemplateStructureDto {
  @ApiProperty({ example: 'Bullish {{asset}} breakout pattern on {{timeframe}}' })
  @IsString()
  @IsNotEmpty()
  rationaleTemplate: string;

  @ApiProperty({ example: 'entry_price * 0.95' })
  @IsString()
  @IsNotEmpty()
  stopLossFormula: string;

  @ApiProperty({ example: 'entry_price * 1.15' })
  @IsString()
  @IsNotEmpty()
  takeProfitFormula: string;

  @ApiPropertyOptional({ example: 'LONG' })
  @IsString()
  @IsOptional()
  direction?: string;

  @ApiPropertyOptional({ example: '4H' })
  @IsString()
  @IsOptional()
  timeframe?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  additionalNotes?: string;
}

export class CreateTemplateDto {
  @ApiProperty({ example: 'Stellar Bullish Breakout' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Template for bullish breakout signals on Stellar pairs' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: TemplateStructureDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TemplateStructureDto)
  structure: TemplateStructureDto;

  @ApiProperty({
    description: 'Variable names used in templates (without {{ }})',
    example: ['asset', 'entry_price'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(/^[a-z_][a-z0-9_]*$/, {
    each: true,
    message: 'Variable names must be snake_case alphanumeric',
  })
  variables: string[];

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;
}
