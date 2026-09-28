import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ContentService } from './content.service';
import { ProviderContent, ContentStatus, ContentType } from './entities/provider-content.entity';
import { ContentEngagement } from './entities/content-engagement.entity';

describe('ContentService — search index refresh events', () => {
  let service: ContentService;
  let contentRepository: any;
  let engagementRepository: any;
  let eventEmitter: { emit: jest.Mock };

  const makeContent = (overrides: Partial<ProviderContent> = {}): ProviderContent =>
    ({
      id: 'content-1',
      providerId: 'provider-1',
      type: ContentType.ARTICLE,
      title: 'Test',
      body: 'Body',
      tags: [],
      published: true,
      status: ContentStatus.PUBLISHED,
      views: 0,
      likes: 0,
      shares: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as ProviderContent;

  beforeEach(async () => {
    contentRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };
    engagementRepository = {};
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: getRepositoryToken(ProviderContent), useValue: contentRepository },
        { provide: getRepositoryToken(ContentEngagement), useValue: engagementRepository },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  describe('create', () => {
    it('emits content.created when the new content is published', async () => {
      const content = makeContent();
      contentRepository.create.mockReturnValue(content);
      contentRepository.save.mockResolvedValue(content);

      await service.create('provider-1', { type: ContentType.ARTICLE, title: 'Test', body: 'Body', published: true } as any);

      expect(eventEmitter.emit).toHaveBeenCalledWith('content.created', content);
    });

    it('does not emit content.created for draft content', async () => {
      const draft = makeContent({ status: ContentStatus.DRAFT, published: false });
      contentRepository.create.mockReturnValue(draft);
      contentRepository.save.mockResolvedValue(draft);

      await service.create('provider-1', { type: ContentType.ARTICLE, title: 'Test', body: 'Body', published: false } as any);

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('emits content.updated when the updated content is published', async () => {
      const existing = makeContent();
      const updated = makeContent({ title: 'New title' });
      contentRepository.findOne.mockResolvedValue(existing);
      contentRepository.save.mockResolvedValue(updated);

      await service.update('content-1', 'provider-1', { title: 'New title' } as any);

      expect(eventEmitter.emit).toHaveBeenCalledWith('content.updated', updated);
    });

    it('emits content.deleted when an update unpublishes the content', async () => {
      const existing = makeContent();
      const unpublished = makeContent({ status: ContentStatus.DRAFT, published: false });
      contentRepository.findOne.mockResolvedValue(existing);
      contentRepository.save.mockResolvedValue(unpublished);

      await service.update('content-1', 'provider-1', { published: false } as any);

      expect(eventEmitter.emit).toHaveBeenCalledWith('content.deleted', 'content-1');
    });

    it('throws and does not emit when the requester does not own the content', async () => {
      contentRepository.findOne.mockResolvedValue(makeContent({ providerId: 'someone-else' }));

      await expect(
        service.update('content-1', 'provider-1', { title: 'x' } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('emits content.deleted after removing the content', async () => {
      const existing = makeContent();
      contentRepository.findOne.mockResolvedValue(existing);
      contentRepository.remove.mockResolvedValue(existing);

      await service.delete('content-1', 'provider-1');

      expect(eventEmitter.emit).toHaveBeenCalledWith('content.deleted', 'content-1');
    });

    it('throws and does not emit when the content does not exist', async () => {
      contentRepository.findOne.mockResolvedValue(null);

      await expect(service.delete('missing', 'provider-1')).rejects.toThrow(NotFoundException);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
