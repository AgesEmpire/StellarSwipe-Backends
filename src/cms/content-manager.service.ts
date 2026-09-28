import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, FindOptionsWhere } from 'typeorm';
import { Content, ContentStatus } from './entities/content.entity';
import { VersionControlService } from './services/version-control.service';
import { TranslationManagerService } from './services/translation-manager.service';
import { MarkdownProcessor } from './utils/markdown-processor';
import { CreateContentDto } from './dto/create-content.dto';
import { ContentQueryDto } from './dto/content-query.dto';
import { TranslateContentDto } from './dto/translate-content.dto';

@Injectable()
export class ContentManagerService {
  private readonly logger = new Logger(ContentManagerService.name);

  constructor(
    @InjectRepository(Content)
    private readonly contentRepo: Repository<Content>,
    private readonly versionControl: VersionControlService,
    private readonly translationManager: TranslationManagerService,
    private readonly markdownProcessor: MarkdownProcessor,
  ) {}

  async create(dto: CreateContentDto): Promise<Content> {
    const existing = await this.contentRepo.findOne({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Content with slug '${dto.slug}' already exists`);

    const sanitizedBody = this.markdownProcessor.sanitize(dto.body);
    const content = this.contentRepo.create({
      ...dto,
      body: sanitizedBody,
      defaultLocale: dto.defaultLocale ?? 'en',
    });

    const saved = await this.contentRepo.save(content);
    await this.versionControl.snapshot(saved, dto.authorId, 'Initial version');
    this.logger.log(`Created content: ${saved.slug}`);
    return saved;
  }

  async findAll(query: ContentQueryDto): Promise<{ data: Content[]; total: number }> {
    const where: FindOptionsWhere<Content> = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;

    const [data, total] = await this.contentRepo.findAndCount({
      where: query.search ? [{ ...where, title: ILike(`%${query.search}%`) }] : where,
      order: { updatedAt: 'DESC' },
      skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
      take: query.limit ?? 20,
    });

    return { data, total };
  }

  async findBySlug(slug: string, locale?: string): Promise<Content & { localizedBody?: string }> {
    const content = await this.contentRepo.findOne({
      where: { slug },
      relations: ['translations'],
    });
    if (!content) throw new NotFoundException(`Content '${slug}' not found`);

    if (locale && locale !== content.defaultLocale) {
      const translation = await this.translationManager.getTranslation(content.id, locale);
      if (translation) {
        return {
          ...content,
          title: translation.title,
          localizedBody: translation.body,
        };
      }
    }

    return content;
  }

  async publish(contentId: string, userId: string, changeNotes?: string): Promise<Content> {
    const content = await this.contentRepo.findOne({ where: { id: contentId } });
    if (!content) throw new NotFoundException(`Content ${contentId} not found`);

    await this.versionControl.snapshot(content, userId, changeNotes);
    content.status = ContentStatus.PUBLISHED;
    content.publishedAt = new Date();

    const saved = await this.contentRepo.save(content);
    this.logger.log(`Published content: ${saved.slug}`);
    return saved;
  }

  async archive(contentId: string): Promise<Content> {
    const content = await this.contentRepo.findOne({ where: { id: contentId } });
    if (!content) throw new NotFoundException(`Content ${contentId} not found`);

    content.status = ContentStatus.ARCHIVED;
    return this.contentRepo.save(content);
  }

  async addTranslation(contentId: string, dto: TranslateContentDto) {
    const content = await this.contentRepo.findOne({ where: { id: contentId } });
    if (!content) throw new NotFoundException(`Content ${contentId} not found`);
    return this.translationManager.upsertTranslation(contentId, dto);
  }

  async approveTranslation(translationId: string, reviewerId: string) {
    return this.translationManager.approveTranslation(translationId, reviewerId);
  }

  async getVersionHistory(contentId: string) {
    return this.versionControl.getVersionHistory(contentId);
  }

  async getContentAsHtml(slug: string, locale?: string): Promise<string> {
    const content = await this.findBySlug(slug, locale);
    const body = (content as any).localizedBody ?? content.body;
    return this.markdownProcessor.toHtml(body);
  }
}
