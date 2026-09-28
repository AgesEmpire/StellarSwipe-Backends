import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserConsent, ConsentCategory } from './entities/user-consent.entity';
import { UpdateConsentDto, ConsentStateDto } from './dto/consent.dto';

@Injectable()
export class ConsentService {
  constructor(
    @InjectRepository(UserConsent)
    private readonly consentRepository: Repository<UserConsent>,
  ) {}

  async getConsentState(userId: string): Promise<ConsentStateDto> {
    const records = await this.consentRepository.find({ where: { userId } });

    // Fill in any missing categories with default opted-out state
    const byCategory = new Map(records.map((r) => [r.category, r]));
    const consents = Object.values(ConsentCategory).map((cat) => {
      const record = byCategory.get(cat);
      return {
        category: cat,
        optedIn: record?.optedIn ?? false,
        updatedAt: record?.updatedAt ?? new Date(0),
      };
    });

    return { userId, consents };
  }

  async updateConsent(userId: string, dto: UpdateConsentDto): Promise<ConsentStateDto> {
    const existing = await this.consentRepository.findOne({
      where: { userId, category: dto.category },
    });

    const now = new Date();

    if (existing) {
      existing.optedIn = dto.optedIn;
      existing.updatedAt = now;
      await this.consentRepository.save(existing);
    } else {
      const record = this.consentRepository.create({
        userId,
        category: dto.category,
        optedIn: dto.optedIn,
        updatedAt: now,
      });
      await this.consentRepository.save(record);
    }

    return this.getConsentState(userId);
  }

  async hasConsented(userId: string, category: ConsentCategory): Promise<boolean> {
    const record = await this.consentRepository.findOne({
      where: { userId, category },
    });
    return record?.optedIn ?? false;
  }
}
