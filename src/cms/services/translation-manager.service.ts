import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Translation, TranslationStatus } from '../entities/translation.entity';
import { TranslationValidator } from '../utils/translation-validator';
import { TranslateContentDto } from '../dto/translate-content.dto';

@Injectable()
export class TranslationManagerService {
  constructor(
    @InjectRepository(Translation)
    private readonly translationRepo: Repository<Translation>,
    private readonly validator: TranslationValidator,
  ) {}

  async upsertTranslation(contentId: string, dto: TranslateContentDto): Promise<Translation> {
    const locale = this.validator.normalizeLocale(dto.locale);
    if (!this.validator.isSupportedLocale(locale)) {
      throw new BadRequestException(`Unsupported locale: ${locale}`);
    }

    let translation = await this.translationRepo.findOne({ where: { contentId, locale } });

    if (translation) {
      translation.title = dto.title;
      translation.body = dto.body;
      translation.status = TranslationStatus.PENDING;
      if (dto.translatorId) translation.translatorId = dto.translatorId;
    } else {
      translation = this.translationRepo.create({
        contentId,
        locale,
        title: dto.title,
        body: dto.body,
        status: TranslationStatus.PENDING,
        translatorId: dto.translatorId,
      });
    }

    return this.translationRepo.save(translation);
  }

  async approveTranslation(translationId: string, reviewerId: string): Promise<Translation> {
    const translation = await this.translationRepo.findOne({ where: { id: translationId } });
    if (!translation) throw new NotFoundException(`Translation ${translationId} not found`);

    translation.status = TranslationStatus.APPROVED;
    translation.reviewedBy = reviewerId;
    translation.reviewedAt = new Date();
    return this.translationRepo.save(translation);
  }

  async getTranslation(contentId: string, locale: string): Promise<Translation | null> {
    return this.translationRepo.findOne({ where: { contentId, locale } });
  }

  async getAllTranslations(contentId: string): Promise<Translation[]> {
    return this.translationRepo.find({ where: { contentId } });
  }

  getSupportedLocales(): string[] {
    return this.validator.getSupportedLocales();
  }
}
