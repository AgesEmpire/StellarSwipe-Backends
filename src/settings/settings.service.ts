import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import {
  UserSettings,
  UserSettingsData,
} from './entities/user-settings.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsResponseDto } from './dto/settings-response.dto';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction } from '../audit-log/entities/audit-log.entity';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly CACHE_TTL = 300000; // 5 minutes

  private readonly DEFAULT_SETTINGS: UserSettingsData = {
    trading: {
      defaultOrderType: 'market',
      defaultSlippage: 1,
      confirmTrades: true,
    },
    risk: {
      maxOpenPositions: 10,
      maxExposure: 50,
      requireStopLoss: true,
    },
    display: {
      theme: 'dark',
      language: 'en',
      currency: 'USD',
    },
    notifications: {
      email: true,
      push: true,
      tradeFills: true,
      priceAlerts: true,
      systemUpdates: true,
    },
  };

  constructor(
    @InjectRepository(UserSettings)
    private userSettingsRepository: Repository<UserSettings>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private readonly auditService: AuditService,
  ) {}

  async getSettings(userId: string): Promise<SettingsResponseDto> {
    const cacheKey = `settings:${userId}`;
    const cached = await this.cacheManager.get<SettingsResponseDto>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit for user ${userId}`);
      return cached;
    }

    let userSettings = await this.userSettingsRepository.findOne({
      where: { userId },
    });

    if (!userSettings) {
      this.logger.log(`Creating default settings for user ${userId}`);
      userSettings = await this.createDefaultSettings(userId);
    }

    const response: SettingsResponseDto = {
      userId: userSettings.userId,
      settings: userSettings.settings,
      updatedAt: userSettings.updatedAt,
    };

    await this.cacheManager.set(cacheKey, response, this.CACHE_TTL);
    return response;
  }

  async updateSettings(
    userId: string,
    updateDto: UpdateSettingsDto,
  ): Promise<SettingsResponseDto> {
    let userSettings = await this.userSettingsRepository.findOne({
      where: { userId },
    });

    if (!userSettings) {
      userSettings = await this.createDefaultSettings(userId);
    }

    // Merge updates with existing settings
    const updatedSettings: UserSettingsData = {
      trading: {
        ...userSettings.settings.trading,
        ...(updateDto.trading || {}),
      },
      risk: {
        ...userSettings.settings.risk,
        ...(updateDto.risk || {}),
      },
      display: {
        ...userSettings.settings.display,
        ...(updateDto.display || {}),
      },
      notifications: {
        ...userSettings.settings.notifications,
        ...(updateDto.notifications || {}),
      },
    };

    userSettings.settings = updatedSettings;
    const saved = await this.userSettingsRepository.save(userSettings);

    // Invalidate cache
    const cacheKey = `settings:${userId}`;
    await this.cacheManager.del(cacheKey);

    this.logger.log(`Updated settings for user ${userId}`);

    await this.auditService.log({
      userId,
      action: AuditAction.SETTINGS_UPDATED,
      resource: 'user_settings',
      resourceId: saved.id,
      metadata: { updatedFields: Object.keys(updateDto) },
    });

    return {
      userId: saved.userId,
      settings: saved.settings,
      updatedAt: saved.updatedAt,
    };
  }

  async resetSettings(userId: string): Promise<SettingsResponseDto> {
    let userSettings = await this.userSettingsRepository.findOne({
      where: { userId },
    });

    if (!userSettings) {
      throw new NotFoundException('User settings not found');
    }

    userSettings.settings = this.DEFAULT_SETTINGS;
    const saved = await this.userSettingsRepository.save(userSettings);

    // Invalidate cache
    const cacheKey = `settings:${userId}`;
    await this.cacheManager.del(cacheKey);

    this.logger.log(`Reset settings to defaults for user ${userId}`);

    await this.auditService.log({
      userId,
      action: AuditAction.SETTINGS_UPDATED,
      resource: 'user_settings',
      resourceId: saved.id,
      metadata: { reset: true },
    });

    return {
      userId: saved.userId,
      settings: saved.settings,
      updatedAt: saved.updatedAt,
    };
  }

  async deleteSettings(userId: string): Promise<void> {
    const result = await this.userSettingsRepository.delete({ userId });

    if (result.affected === 0) {
      throw new NotFoundException('User settings not found');
    }

    // Invalidate cache
    const cacheKey = `settings:${userId}`;
    await this.cacheManager.del(cacheKey);

    this.logger.log(`Deleted settings for user ${userId}`);
  }

  private async createDefaultSettings(userId: string): Promise<UserSettings> {
    const userSettings = this.userSettingsRepository.create({
      userId,
      settings: this.DEFAULT_SETTINGS,
    });

    return this.userSettingsRepository.save(userSettings);
  }

  getDefaultSettings(): UserSettingsData {
    return { ...this.DEFAULT_SETTINGS };
  }
}
