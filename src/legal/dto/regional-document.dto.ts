import { IsString, IsOptional, IsEnum } from 'class-validator';
import { DocumentType } from '../entities/legal-document.entity';

export class RegionalDocumentQueryDto {
  @IsString()
  region!: string;

  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional()
  @IsString()
  language?: string;
}

export interface RequiredDocumentsResult {
  userId: string;
  region: string;
  pending: Array<{
    documentId: string;
    documentTitle: string;
    versionId: string;
    version: string;
    type: DocumentType;
  }>;
  allAccepted: boolean;
}
