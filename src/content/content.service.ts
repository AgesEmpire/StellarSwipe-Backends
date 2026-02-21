import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import {
  ProviderContent,
  ContentType,
  ContentStatus,
} from './entities/provider-content.entity';
import {
  ContentEngagement,
  EngagementType,
} from './entities/content-engagement.entity';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ContentQueryDto } from './dto/content-query.dto';
import { CreateEngagementDto } from './dto/engagement.dto';
import {
  ContentResponseDto,
  ContentListResponseDto,
} from './dto/content-response.dto';

@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(ProviderContent)
    private contentRepository: Repository<ProviderContent>,
    @InjectRepository(ContentEngagement)
    private engagementRepository: Repository<ContentEngagement>,
  ) {}

  async create(
    providerId: string,
    createContentDto: CreateContentDto,
  ): Promise<ContentResponseDto> {
    // Validate video content has videoUrl
    if (
      createContentDto.type === ContentType.VIDEO &&
      !createContentDto.videoUrl
    ) {
      throw new BadRequestException('Video content requires videoUrl');
    }

    // Validate video URL format (YouTube, Vimeo)
    if (createContentDto.videoUrl) {
      this.validateVideoUrl(createContentDto.videoUrl);
    }

    const content = this.contentRepository.create({
      ...createContentDto,
      providerId,
      status: createContentDto.published
        ? ContentStatus.PUBLISHED
        : ContentStatus.DRAFT,
    });

    const saved = await this.contentRepository.save(content);
    return this.toResponseDto(saved);
  }

  async findAll(query: ContentQueryDto): Promise<ContentListResponseDto> {
    const { type, providerId, tags, search, page = 1, limit = 20 } = query;

    const queryBuilder = this.contentRepository
      .createQueryBuilder('content')
      .where('content.published = :published', { published: true })
      .andWhere('content.status = :status', { status: ContentStatus.PUBLISHED });

    if (type) {
      queryBuilder.andWhere('content.type = :type', { type });
    }

    if (providerId) {
      queryBuilder.andWhere('content.providerId = :providerId', { providerId });
    }

    if (tags && tags.length > 0) {
      queryBuilder.andWhere('content.tags && :tags', { tags });
    }

    if (search) {
      queryBuilder.andWhere(
        '(content.title ILIKE :search OR content.body ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [content, total] = await queryBuilder
      .orderBy('content.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      content: content.map((c) => this.toResponseDto(c)),
      total,
      page,
      limit,
    };
  }

  async findByProvider(providerId: string): Promise<ContentResponseDto[]> {
    const content = await this.contentRepository.find({
      where: {
        providerId,
        published: true,
        status: ContentStatus.PUBLISHED,
      },
      order: { createdAt: 'DESC' },
    });

    return content.map((c) => this.toResponseDto(c));
  }

  async findOne(id: string): Promise<ContentResponseDto> {
    const content = await this.contentRepository.findOne({
      where: { id },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    return this.toResponseDto(content);
  }

  async update(
    id: string,
    providerId: string,
    updateContentDto: UpdateContentDto,
  ): Promise<ContentResponseDto> {
    const content = await this.contentRepository.findOne({ where: { id } });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    if (content.providerId !== providerId) {
      throw new ForbiddenException('Not authorized to update this content');
    }

    // Validate video URL if provided
    if (updateContentDto.videoUrl) {
      this.validateVideoUrl(updateContentDto.videoUrl);
    }

    Object.assign(content, updateContentDto);

    if (updateContentDto.published !== undefined) {
      content.status = updateContentDto.published
        ? ContentStatus.PUBLISHED
        : ContentStatus.DRAFT;
    }

    const updated = await this.contentRepository.save(content);
    return this.toResponseDto(updated);
  }

  async delete(id: string, providerId: string): Promise<void> {
    const content = await this.contentRepository.findOne({ where: { id } });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    if (content.providerId !== providerId) {
      throw new ForbiddenException('Not authorized to delete this content');
    }

    await this.contentRepository.remove(content);
  }

  async recordEngagement(
    contentId: string,
    userId: string,
    engagementDto: CreateEngagementDto,
  ): Promise<void> {
    const content = await this.contentRepository.findOne({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    // Check if engagement already exists (for likes)
    if (engagementDto.type === EngagementType.LIKE) {
      const existing = await this.engagementRepository.findOne({
        where: {
          contentId,
          userId,
          type: EngagementType.LIKE,
        },
      });

      if (existing) {
        // Unlike - remove engagement
        await this.engagementRepository.remove(existing);
        content.likes = Math.max(0, content.likes - 1);
        await this.contentRepository.save(content);
        return;
      }
    }

    // Create engagement
    const engagement = this.engagementRepository.create({
      contentId,
      userId,
      type: engagementDto.type,
      flagReason: engagementDto.flagReason,
    });

    await this.engagementRepository.save(engagement);

    // Update content counters
    switch (engagementDto.type) {
      case EngagementType.VIEW:
        content.views++;
        break;
      case EngagementType.LIKE:
        content.likes++;
        break;
      case EngagementType.SHARE:
        content.shares++;
        break;
      case EngagementType.FLAG:
        // Flag content for moderation
        content.status = ContentStatus.FLAGGED;
        content.flagReason = engagementDto.flagReason;
        break;
    }

    await this.contentRepository.save(content);
  }

  async getPopularTags(limit: number = 20): Promise<string[]> {
    const result = await this.contentRepository
      .createQueryBuilder('content')
      .select('UNNEST(content.tags)', 'tag')
      .where('content.published = :published', { published: true })
      .groupBy('tag')
      .orderBy('COUNT(*)', 'DESC')
      .limit(limit)
      .getRawMany();

    return result.map((r) => r.tag);
  }

  private validateVideoUrl(url: string): void {
    const youtubeRegex =
      /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
    const vimeoRegex = /^(https?:\/\/)?(www\.)?vimeo\.com\/.+$/;

    if (!youtubeRegex.test(url) && !vimeoRegex.test(url)) {
      throw new BadRequestException(
        'Invalid video URL. Only YouTube and Vimeo are supported',
      );
    }
  }

  private toResponseDto(content: ProviderContent): ContentResponseDto {
    return {
      id: content.id,
      providerId: content.providerId,
      type: content.type,
      title: content.title,
      body: content.body,
      tags: content.tags,
      published: content.published,
      status: content.status,
      views: content.views,
      likes: content.likes,
      shares: content.shares,
      thumbnailUrl: content.thumbnailUrl,
      videoUrl: content.videoUrl,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
    };
  }
}
