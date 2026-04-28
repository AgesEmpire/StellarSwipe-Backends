import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LegalDocument, DocumentStatus } from './entities/legal-document.entity';
import { CreateLegalDocumentDto, UpdateLegalDocumentDto } from './dto/legal-document.dto';
import { RegionalDocumentQueryDto } from './dto/regional-document.dto';
import { VersionManagerService } from './services/version-manager.service';
import { AcceptanceTrackerService } from './services/acceptance-tracker.service';
import { CreateDocumentVersionDto } from './dto/document-version.dto';
import { RecordAcceptanceDto } from './dto/acceptance-record.dto';

@Injectable()
export class DocumentManagerService {
  constructor(
    @InjectRepository(LegalDocument)
    private documentRepository: Repository<LegalDocument>,
    private versionManager: VersionManagerService,
    private acceptanceTracker: AcceptanceTrackerService,
  ) {}

  async create(dto: CreateLegalDocumentDto): Promise<LegalDocument> {
    const document = this.documentRepository.create({ ...dto, language: dto.language ?? 'en' });
    return this.documentRepository.save(document);
  }

  async findAll(query: RegionalDocumentQueryDto): Promise<LegalDocument[]> {
    const where: Partial<LegalDocument> = { region: query.region };
    if (query.type) where.type = query.type;
    if (query.language) where.language = query.language;
    return this.documentRepository.find({ where, relations: ['versions'] });
  }

  async findOne(id: string): Promise<LegalDocument> {
    const doc = await this.documentRepository.findOne({ where: { id }, relations: ['versions'] });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateLegalDocumentDto): Promise<LegalDocument> {
    const doc = await this.findOne(id);
    Object.assign(doc, dto);
    return this.documentRepository.save(doc);
  }

  async archive(id: string): Promise<LegalDocument> {
    return this.update(id, { status: DocumentStatus.ARCHIVED });
  }

  async createVersion(documentId: string, dto: CreateDocumentVersionDto): Promise<any> {
    return this.versionManager.createVersion(documentId, dto);
  }

  async publishVersion(documentId: string, versionId: string, publishedBy: string): Promise<any> {
    return this.versionManager.publishVersion(documentId, versionId, publishedBy);
  }

  async getVersionDiff(documentId: string, fromId: string, toId: string): Promise<any> {
    return this.versionManager.getDiff(documentId, fromId, toId);
  }

  async recordAcceptance(
    userId: string,
    dto: RecordAcceptanceDto,
    context: { ipAddress?: string; userAgent?: string; region?: string },
  ): Promise<any> {
    return this.acceptanceTracker.recordAcceptance(userId, dto.documentId, dto.versionId, {
      ...context,
      metadata: dto.metadata,
    });
  }

  async getPendingDocuments(userId: string, region: string): Promise<any> {
    return this.acceptanceTracker.getPendingDocuments(userId, region);
  }
}
