import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FileUploadResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'report.pdf' })
  originalName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ example: 1048576 })
  size!: number;

  @ApiProperty({ example: 'pdf' })
  extension!: string;

  @ApiProperty({ example: 'uploads/2026/07/29/abc123.pdf' })
  storagePath!: string;

  @ApiProperty({ example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' })
  contentHash!: string;

  @ApiProperty({ example: '2026-07-29T00:00:00.000Z' })
  uploadedAt!: Date;
}

export class FileValidationErrorDto {
  @ApiProperty({ example: 'INVALID_FILE_TYPE' })
  code!: string;

  @ApiProperty({ example: 'File type image/svg+xml is not allowed. Allowed types: image/jpeg, image/png, image/gif, image/webp, application/pdf, text/plain, application/json, text/csv' })
  message!: string;
}

export class FileUploadErrorDto {
  @ApiProperty({ type: [FileValidationErrorDto] })
  errors!: FileValidationErrorDto[];
}

export class BatchFileUploadResponseDto {
  @ApiProperty({ type: [FileUploadResponseDto] })
  files!: FileUploadResponseDto[];

  @ApiProperty({ type: [FileUploadErrorDto], description: 'List of upload errors for files that failed validation' })
  failed!: FileUploadErrorDto[];
}
