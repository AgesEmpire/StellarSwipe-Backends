import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContentManagerService } from './content-manager.service';
import { Content, ContentType, ContentStatus } from './entities/content.entity';
import { VersionControlService } from './services/version-control.service';
import { TranslationManagerService } from './services/translation-manager.service';
import { MarkdownProcessor } from './utils/markdown-processor';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn((dto) => ({ ...dto, id: 'content-uuid' })),
});

const mockVersionControl = { snapshot: jest.fn(), getVersionHistory: jest.fn() };
const mockTranslationManager = { upsertTranslation: jest.fn(), getTranslation: jest.fn(), approveTranslation: jest.fn() };

describe('ContentManagerService', () => {
  let service: ContentManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentManagerService,
        MarkdownProcessor,
        { provide: getRepositoryToken(Content), useFactory: mockRepo },
        { provide: VersionControlService, useValue: mockVersionControl },
        { provide: TranslationManagerService, useValue: mockTranslationManager },
      ],
    }).compile();

    service = module.get<ContentManagerService>(ContentManagerService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create content', async () => {
    const contentRepo = service['contentRepo'];
    jest.spyOn(contentRepo, 'findOne').mockResolvedValue(null);
    jest.spyOn(contentRepo, 'save').mockResolvedValue({ id: 'content-uuid', slug: 'test-slug' } as any);
    mockVersionControl.snapshot.mockResolvedValue({});

    const result = await service.create({
      slug: 'test-slug',
      title: 'Test',
      body: '# Hello',
      type: ContentType.HELP_DOC,
      authorId: 'user-1',
    });

    expect(result.slug).toBe('test-slug');
    expect(mockVersionControl.snapshot).toHaveBeenCalled();
  });

  it('should throw ConflictException for duplicate slug', async () => {
    const contentRepo = service['contentRepo'];
    jest.spyOn(contentRepo, 'findOne').mockResolvedValue({ id: 'existing' } as any);

    await expect(
      service.create({ slug: 'duplicate', title: 'T', body: 'B', type: ContentType.TUTORIAL, authorId: 'u1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('should throw NotFoundException for unknown slug', async () => {
    const contentRepo = service['contentRepo'];
    jest.spyOn(contentRepo, 'findOne').mockResolvedValue(null);

    await expect(service.findBySlug('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('should publish content', async () => {
    const mockContent = { id: 'c1', slug: 'test', status: ContentStatus.DRAFT } as any;
    const contentRepo = service['contentRepo'];
    jest.spyOn(contentRepo, 'findOne').mockResolvedValue(mockContent);
    jest.spyOn(contentRepo, 'save').mockResolvedValue({ ...mockContent, status: ContentStatus.PUBLISHED } as any);
    mockVersionControl.snapshot.mockResolvedValue({});

    const result = await service.publish('c1', 'user-1');
    expect(result.status).toBe(ContentStatus.PUBLISHED);
  });
});
