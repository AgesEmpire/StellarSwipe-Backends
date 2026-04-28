import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentVersion } from '../entities/document-version.entity';
import { LegalDocument } from '../entities/legal-document.entity';
import { CreateDocumentVersionDto } from '../dto/document-version.dto';
import { DocumentGenerator } from '../utils/document-generator';
import { DiffGenerator } from '../utils/diff-generator';

@Injectable()
export class VersionManagerService {
  constructor(
    @InjectRepository(DocumentVersion)
    private versionRepository: Repository<DocumentVersion>,
    @InjectRepository(LegalDocument)
    private documentRepository: Repository<LegalDocument>,
    private documentGenerator: DocumentGenerator,
    private diffGenerator: DiffGenerator,
  ) {}

  async createVersion(documentId: string, dto: CreateDocumentVersionDto): Promise<DocumentVersion> {
    const document = await this.documentRepository.findOne({ where: { id: documentId } });
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);

    const existing = await this.versionRepository.findOne({
      where: { documentId, version: dto.version },
    });
    if (existing) {
      throw new BadRequestException(`Version ${dto.version} already exists for document ${documentId}`);
    }

    const version = this.versionRepository.create({
      documentId,
      version: dto.version,
      content: dto.content,
      contentHash: this.documentGenerator.hashContent(dto.content),
      changelog: dto.changelog ?? null,
      requiresReacceptance: dto.requiresReacceptance ?? false,
      isActive: false,
    });

    return this.versionRepository.save(version);
  }

  async publishVersion(documentId: string, versionId: string, publishedBy: string): Promise<DocumentVersion> {
    const version = await this.versionRepository.findOne({
      where: { id: versionId, documentId },
    });
    if (!version) throw new NotFoundException(`Version ${versionId} not found`);

    // Deactivate existing active version
    await this.versionRepository.update({ documentId, isActive: true }, { isActive: false });

    version.isActive = true;
    version.publishedAt = new Date();
    version.publishedBy = publishedBy;
    await this.versionRepository.save(version);

    await this.documentRepository.update({ id: documentId }, { currentVersionId: versionId });

    return version;
  }

  async getVersions(documentId: string): Promise<DocumentVersion[]> {
    return this.versionRepository.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
    });
  }

  async getActiveVersion(documentId: string): Promise<DocumentVersion | null> {
    return this.versionRepository.findOne({ where: { documentId, isActive: true } });
  }

  async getDiff(documentId: string, fromVersionId: string, toVersionId: string) {
    const [from, to] = await Promise.all([
      this.versionRepository.findOne({ where: { id: fromVersionId, documentId } }),
      this.versionRepository.findOne({ where: { id: toVersionId, documentId } }),
    ]);

    if (!from || !to) throw new NotFoundException('One or both versions not found');

    const diff = this.diffGenerator.generateDiff(from.content, to.content);
    return { diff, summary: this.diffGenerator.summarizeDiff(diff) };
  }
}
