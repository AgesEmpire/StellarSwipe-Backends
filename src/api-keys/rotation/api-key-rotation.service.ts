import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { ApiKey } from '../../entities/api-key.entity';
import { RotationScheduleDto, RotationResultDto } from './dto/rotation-schedule.dto';

@Injectable()
export class ApiKeyRotationService {
  private readonly logger = new Logger(ApiKeyRotationService.name);

  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
  ) {}

  async scheduleRotation(userId: string, keyId: string, dto: RotationScheduleDto): Promise<{ nextRotationAt: Date }> {
    const key = await this.apiKeyRepo.findOne({ where: { id: keyId, userId } });
    if (!key) throw new NotFoundException('API key not found');

    const nextRotationAt = new Date();
    nextRotationAt.setDate(nextRotationAt.getDate() + dto.rotationIntervalDays);

    await this.apiKeyRepo.update(keyId, { expiresAt: nextRotationAt });
    this.logger.log(`Scheduled rotation for key ${keyId} at ${nextRotationAt}`);
    return { nextRotationAt };
  }

  async rotateKey(userId: string, keyId: string): Promise<RotationResultDto> {
    const key = await this.apiKeyRepo.findOne({ where: { id: keyId, userId } });
    if (!key) throw new NotFoundException('API key not found');

    const rawKey = `sk_live_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = await bcrypt.hash(rawKey, 10);

    const nextRotationAt = new Date();
    nextRotationAt.setDate(nextRotationAt.getDate() + 90);

    await this.apiKeyRepo.update(keyId, { keyHash, expiresAt: nextRotationAt });

    this.logger.log(`Rotated API key ${keyId} for user ${userId}`);
    return {
      keyId,
      newKey: rawKey,
      rotatedAt: new Date(),
      nextRotationAt,
    };
  }

  async rotateExpiredKeys(): Promise<number> {
    const now = new Date();
    const expiredKeys = await this.apiKeyRepo.find({
      where: { expiresAt: LessThan(now) },
    });

    let count = 0;
    for (const key of expiredKeys) {
      try {
        const rawKey = `sk_live_${crypto.randomBytes(32).toString('hex')}`;
        const keyHash = await bcrypt.hash(rawKey, 10);
        const nextRotationAt = new Date();
        nextRotationAt.setDate(nextRotationAt.getDate() + 90);
        await this.apiKeyRepo.update(key.id, { keyHash, expiresAt: nextRotationAt });
        count++;
      } catch (err) {
        this.logger.error(`Failed to rotate key ${key.id}`, err);
      }
    }
    return count;
  }
}
