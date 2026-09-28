import {
  IsEnum,
  IsOptional,
  IsDateString,
  IsUUID,
  IsString,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AuditExportFormat {
  CSV = 'csv',
  JSON = 'json',
  PDF = 'pdf',
}

export class AuditExportRequestDto {
  @ApiPropertyOptional({
    enum: AuditExportFormat,
    default: AuditExportFormat.CSV,
  })
  @IsOptional()
  @IsEnum(AuditExportFormat)
  format?: AuditExportFormat = AuditExportFormat.CSV;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by specific audit action type' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Filter by specific audit action types',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  actions?: string[];

  @ApiPropertyOptional({ description: 'Resource type filter' })
  @IsOptional()
  @IsString()
  resource?: string;

  @ApiPropertyOptional({ description: 'Resource ID filter' })
  @IsOptional()
  @IsString()
  resourceId?: string;
}
