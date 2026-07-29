import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DocumentType, DocumentStatus } from '../entities/legal-document.entity';

export class CreateLegalDocumentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsEnum(DocumentType)
  type!: DocumentType;

  @IsString()
  @MinLength(2)
  @MaxLength(10)
  region!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateLegalDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
