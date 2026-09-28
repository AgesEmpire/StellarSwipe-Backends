import { IsEnum, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExportFormat } from '../entities/bulk-export.entity';

export class TaxReportDto {
  @ApiProperty({ description: 'Start of the tax reporting period (ISO 8601)' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: 'End of the tax reporting period (ISO 8601)' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ enum: ExportFormat, default: ExportFormat.CSV })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;
}
