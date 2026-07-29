import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferenceDto } from './dto/preference.dto';

export type NotificationType =
  | 'tradeUpdates'
  | 'signalPerformance'
  | 'systemAlerts'
  | 'marketing';

export type NotificationChannelType = 'email' | 'push';

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
  ) {}

  /**
   * Retrieve current notification preferences for a user.
   * Creates default preferences if none exist.
   */
  async getPreferences(userId: string): Promise<PreferenceDto> {
    const preference = await this.findOrCreate(userId);
    return this.toDto(preference);
  }

  /**
   * Update notification preferences for a user.
   * Only provided fields are updated; others remain unchanged.
   */
  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<PreferenceDto> {
    const preference = await this.findOrCreate(userId);

    if (dto.tradeUpdates !== undefined) {
      if (dto.tradeUpdates.email !== undefined) {
        preference.tradeUpdatesEmail = dto.tradeUpdates.email;
      }
      if (dto.tradeUpdates.push !== undefined) {
        preference.tradeUpdatesPush = dto.tradeUpdates.push;
      }
    }

    if (dto.signalPerformance !== undefined) {
      if (dto.signalPerformance.email !== undefined) {
        preference.signalPerformanceEmail = dto.signalPerformance.email;
      }
      if (dto.signalPerformance.push !== undefined) {
        preference.signalPerformancePush = dto.signalPerformance.push;
      }
    }

    if (dto.systemAlerts !== undefined) {
      if (dto.systemAlerts.email !== undefined) {
        preference.systemAlertsEmail = dto.systemAlerts.email;
      }
      if (dto.systemAlerts.push !== undefined) {
        preference.systemAlertsPush = dto.systemAlerts.push;
      }
    }

    if (dto.marketing !== undefined) {
      if (dto.marketing.email !== undefined) {
        preference.marketingEmail = dto.marketing.email;
      }
      if (dto.marketing.push !== undefined) {
        preference.marketingPush = dto.marketing.push;
      }
    }

    const saved = await this.preferenceRepository.save(preference);
    return this.toDto(saved);
  }

  /**
   * Check whether a specific notification type/channel is enabled for a user.
   * Used by the notification delivery pipeline before dispatching.
   */
  async isEnabled(
    userId: string,
    type: NotificationType,
    channel: NotificationChannelType,
  ): Promise<boolean> {
    const preference = await this.findOrCreate(userId);

    const map: Record<NotificationType, Record<NotificationChannelType, boolean>> = {
      tradeUpdates: {
        email: preference.tradeUpdatesEmail,
        push: preference.tradeUpdatesPush,
      },
      signalPerformance: {
        email: preference.signalPerformanceEmail,
        push: preference.signalPerformancePush,
      },
      systemAlerts: {
        email: preference.systemAlertsEmail,
        push: preference.systemAlertsPush,
      },
      marketing: {
        email: preference.marketingEmail,
        push: preference.marketingPush,
      },
    };

    return map[type][channel];
  }

  /**
   * Unsubscribe a user from a specific notification type and channel.
   * Intended for use by email unsubscribe links.
   */
  async unsubscribe(
    userId: string,
    type: NotificationType,
    channel: NotificationChannelType,
  ): Promise<PreferenceDto> {
    const dto: UpdatePreferencesDto = {
      [type]: { [channel]: false },
    };
    return this.updatePreferences(userId, dto);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async findOrCreate(userId: string): Promise<NotificationPreference> {
    const existing = await this.preferenceRepository.findOne({
      where: { userId },
    });

    if (existing) return existing;

    const preference = this.preferenceRepository.create({ userId });
    return this.preferenceRepository.save(preference);
  }

  private toDto(preference: NotificationPreference): PreferenceDto {
    return {
      userId: preference.userId,
      tradeUpdates: {
        email: preference.tradeUpdatesEmail,
        push: preference.tradeUpdatesPush,
      },
      signalPerformance: {
        email: preference.signalPerformanceEmail,
        push: preference.signalPerformancePush,
      },
      systemAlerts: {
        email: preference.systemAlertsEmail,
        push: preference.systemAlertsPush,
      },
      marketing: {
        email: preference.marketingEmail,
        push: preference.marketingPush,
      },
      updatedAt: preference.updatedAt,
    };
  }
}
