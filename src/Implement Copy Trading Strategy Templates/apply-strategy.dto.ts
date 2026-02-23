import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StrategyParametersOverrideDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minProviderReputation?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  maxOpenPositions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  defaultStopLoss?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minSignalConfidence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredAssets?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(100)
  maxPositionSize?: number;
}

export class ApplyStrategyDto {
  @ApiProperty({ example: 'conservative' })
  @IsString()
  templateId: string;

  @ApiPropertyOptional({ type: StrategyParametersOverrideDto })
  @IsOptional()
  @Type(() => StrategyParametersOverrideDto)
  overrides?: StrategyParametersOverrideDto;
}

export class CreateCustomTemplateDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ enum: ['conservative', 'balanced', 'aggressive'] })
  @IsIn(['conservative', 'balanced', 'aggressive'])
  riskLevel: 'conservative' | 'balanced' | 'aggressive';

  @ApiProperty({ type: StrategyParametersOverrideDto })
  @Type(() => StrategyParametersOverrideDto)
  parameters: StrategyParametersOverrideDto;
}
