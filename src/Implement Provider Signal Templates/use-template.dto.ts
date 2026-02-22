import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsNumber,
  IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UseTemplateDto {
  @ApiProperty({ example: 'uuid-of-template' })
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @ApiProperty({
    description: 'Key-value map of variable substitutions',
    example: {
      asset: 'USDC/XLM',
      entry_price: 0.095,
    },
  })
  @IsObject()
  variables: Record<string, string | number>;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  structure?: Partial<{
    rationaleTemplate: string;
    stopLossFormula: string;
    takeProfitFormula: string;
    direction: string;
    timeframe: string;
    additionalNotes: string;
  }>;

  @ApiPropertyOptional()
  @IsOptional()
  variables?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  isPublic?: boolean;
}
