import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAcceptance } from '../entities/user-acceptance.entity';
import { LegalDocument } from '../entities/legal-document.entity';
import { DocumentVersion } from '../entities/document-version.entity';
import { RequiredDocumentsResult } from '../dto/regional-document.dto';
import { DocumentType } from '../entities/legal-document.entity';

@Injectable()
export class AcceptanceTrackerService {
  constructor(
    @InjectRepository(UserAcceptance)
    private acceptanceRepository: Repository<UserAcceptance>,
    @InjectRepository(LegalDocument)
    private documentRepository: Repository<LegalDocument>,
    @InjectRepository(DocumentVersion)
    private versionRepository: Repository<DocumentVersion>,
  ) {}

  async recordAcceptance(
    userId: string,
    documentId: string,
    versionId: string,
    context: { ipAddress?: string; userAgent?: string; region?: string; metadata?: Record<string, unknown> },
  ): Promise<UserAcceptance> {
    const [document, version] = await Promise.all([
      this.documentRepository.findOne({ where: { id: documentId } }),
      this.versionRepository.findOne({ where: { id: versionId, documentId } }),
    ]);
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    if (!version) throw new NotFoundException(`Version ${versionId} not found`);

    const acceptance = this.acceptanceRepository.create({
      userId,
      documentId,
      versionId,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      region: context.region ?? null,
      metadata: context.metadata ?? {},
    });
    return this.acceptanceRepository.save(acceptance);
  }

  async hasAccepted(userId: string, documentId: string, versionId: string): Promise<boolean> {
    const count = await this.acceptanceRepository.count({ where: { userId, documentId, versionId } });
    return count > 0;
  }

  async getUserAcceptances(userId: string): Promise<UserAcceptance[]> {
    return this.acceptanceRepository.find({
      where: { userId },
      relations: ['document', 'version'],
      order: { acceptedAt: 'DESC' },
    });
  }

  async getPendingDocuments(userId: string, region: string): Promise<RequiredDocumentsResult> {
    const activeDocuments = await this.documentRepository.find({
      where: { region },
      relations: ['versions'],
    });

    const pending: RequiredDocumentsResult['pending'] = [];

    for (const doc of activeDocuments) {
      const activeVersion = doc.versions?.find((v) => v.isActive);
      if (!activeVersion) continue;

      const accepted = await this.hasAccepted(userId, doc.id, activeVersion.id);
      if (!accepted) {
        pending.push({
          documentId: doc.id,
          documentTitle: doc.title,
          versionId: activeVersion.id,
          version: activeVersion.version,
          type: doc.type,
        });
      }
    }

    return { userId, region, pending, allAccepted: pending.length === 0 };
  }
}
