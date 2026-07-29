import { IsString, IsOptional, IsObject } from 'class-validator';

export class RecordAcceptanceDto {
  @IsString()
  documentId!: string;

  @IsString()
  versionId!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AcceptanceQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  documentId?: string;

  @IsOptional()
  @IsString()
  versionId?: string;
}
