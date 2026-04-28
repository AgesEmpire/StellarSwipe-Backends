import { IsEnum, IsOptional, IsDateString, IsObject } from 'class-validator';
import { ExportFormat, ExportType } from '../entities/bulk-export.entity';

export class InitiateExportDto {
  @IsEnum(ExportType)
  type!: ExportType;

  @IsEnum(ExportFormat)
  @IsOptional()
  format?: ExportFormat;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}
