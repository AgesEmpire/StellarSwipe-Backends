import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditExportResultDto {
  @ApiProperty({ description: 'Unique export identifier' })
  id!: string;

  @ApiProperty({ description: 'Export format' })
  format!: string;

  @ApiProperty({ description: 'Number of records exported' })
  recordCount!: number;

  @ApiProperty({ description: 'Download URL for the exported file' })
  downloadUrl!: string;

  @ApiProperty()
  generatedAt!: Date;

  @ApiPropertyOptional({ description: 'File size in bytes' })
  fileSizeBytes?: number;

  @ApiPropertyOptional({ description: 'Expiry time for the download URL' })
  expiresAt?: Date;
}
