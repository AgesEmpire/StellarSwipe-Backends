import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';
import { UpdatePreferencesDto } from '../dto/update-preferences.dto';

export interface PreferenceChannel {
  email: boolean;
  push: boolean;
}

export interface PreferencesResponse {
  userId: string;
  tradeUpdates: PreferenceChannel;
  signalPerformance: PreferenceChannel;
  systemAlerts: PreferenceChannel;
  marketing: PreferenceChannel;
  updatedAt: Date;
}

export type NotificationType =
  | 'tradeUpdates'
  | 'signalPerformance'
  | 'systemAlerts'
  | 'marketing';

export type NotificationChannel = 'email' | 'push';

@Injectable()
export class PreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
  ) {}

  async getPreferences(userId: string): Promise<PreferencesResponse> {
    const preference = await this.findOrCreate(userId);
    return this.toResponse(preference);
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<PreferencesResponse> {
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
    return this.toResponse(saved);
  }

  /**
   * Check if a user has a specific notification type/channel enabled.
   * Call this before sending any notification.
   */
  async isEnabled(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const preference = await this.findOrCreate(userId);

    const map: Record<
      NotificationType,
      Record<NotificationChannel, boolean>
    > = {
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
   * Unsubscribe a user from a specific type and channel.
   * Used by unsubscribe links in emails.
   */
  async unsubscribe(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<PreferencesResponse> {
    const dto: UpdatePreferencesDto = {
      [type]: { [channel]: false },
    };
    return this.updatePreferences(userId, dto);
  }

  private async findOrCreate(userId: string): Promise<NotificationPreference> {
    const existing = await this.preferenceRepository.findOne({
      where: { userId },
    });

    if (existing) return existing;

    // Create with defaults defined on the entity columns
    const preference = this.preferenceRepository.create({ userId });
    return this.preferenceRepository.save(preference);
  }

  private toResponse(preference: NotificationPreference): PreferencesResponse {
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
