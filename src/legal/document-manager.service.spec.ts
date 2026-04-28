import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DocumentManagerService } from './document-manager.service';
import { LegalDocument, DocumentType, DocumentStatus } from './entities/legal-document.entity';
import { VersionManagerService } from './services/version-manager.service';
import { AcceptanceTrackerService } from './services/acceptance-tracker.service';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
});

describe('DocumentManagerService', () => {
  let service: DocumentManagerService;
  let repo: ReturnType<typeof mockRepo>;
  let versionManager: { createVersion: jest.Mock; publishVersion: jest.Mock; getDiff: jest.Mock };
  let acceptanceTracker: { recordAcceptance: jest.Mock; getPendingDocuments: jest.Mock };

  beforeEach(async () => {
    versionManager = {
      createVersion: jest.fn(),
      publishVersion: jest.fn(),
      getDiff: jest.fn(),
    };
    acceptanceTracker = {
      recordAcceptance: jest.fn(),
      getPendingDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentManagerService,
        { provide: getRepositoryToken(LegalDocument), useFactory: mockRepo },
        { provide: VersionManagerService, useValue: versionManager },
        { provide: AcceptanceTrackerService, useValue: acceptanceTracker },
      ],
    }).compile();

    service = module.get(DocumentManagerService);
    repo = module.get(getRepositoryToken(LegalDocument));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a legal document with default language en', async () => {
      const dto = { title: 'T&C', type: DocumentType.TERMS_OF_SERVICE, region: 'US' };
      const doc = { id: 'uuid-1', ...dto, language: 'en' } as LegalDocument;
      repo.create.mockReturnValue(doc);
      repo.save.mockResolvedValue(doc);

      const result = await service.create(dto);

      expect(result.language).toBe('en');
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException when document not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should return a document when found', async () => {
      const doc = { id: 'uuid-1', title: 'T&C', type: DocumentType.TERMS_OF_SERVICE } as LegalDocument;
      repo.findOne.mockResolvedValue(doc);
      const result = await service.findOne('uuid-1');
      expect(result).toEqual(doc);
    });
  });

  describe('archive', () => {
    it('should set document status to archived', async () => {
      const doc = { id: 'uuid-1', status: DocumentStatus.ACTIVE } as LegalDocument;
      repo.findOne.mockResolvedValue(doc);
      repo.save.mockResolvedValue({ ...doc, status: DocumentStatus.ARCHIVED });

      const result = await service.archive('uuid-1');
      expect(result.status).toBe(DocumentStatus.ARCHIVED);
    });
  });

  describe('getPendingDocuments', () => {
    it('should delegate to acceptanceTracker', async () => {
      const expected = { userId: 'u1', region: 'US', pending: [], allAccepted: true };
      acceptanceTracker.getPendingDocuments.mockResolvedValue(expected);

      const result = await service.getPendingDocuments('u1', 'US');
      expect(result).toEqual(expected);
      expect(acceptanceTracker.getPendingDocuments).toHaveBeenCalledWith('u1', 'US');
    });
  });
});
