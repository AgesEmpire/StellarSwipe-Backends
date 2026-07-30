import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
  quietHours: {
    enabled: boolean;
    start?: string;
    end?: string;
    timezone: string;
  };
  thresholds: Partial<Record<NotificationType, number>>;
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

    if (dto.quietHours !== undefined) {
      if (dto.quietHours.enabled !== undefined) {
        preference.quietHoursEnabled = dto.quietHours.enabled;
      }
      if (dto.quietHours.start !== undefined) {
        preference.quietHoursStart = dto.quietHours.start;
      }
      if (dto.quietHours.end !== undefined) {
        preference.quietHoursEnd = dto.quietHours.end;
      }
      if (dto.quietHours.timezone !== undefined) {
        preference.timezone = dto.quietHours.timezone;
      }
      if (
        (preference.quietHoursEnabled || dto.quietHours.enabled) &&
        (!preference.quietHoursStart || !preference.quietHoursEnd)
      ) {
        throw new BadRequestException(
          'quietHours.start and quietHours.end are required to enable quiet hours',
        );
      }
    }

    if (dto.thresholds !== undefined) {
      preference.thresholds = { ...preference.thresholds, ...dto.thresholds };
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
    return this.channelMap(preference)[type][channel];
  }

  /**
   * Full delivery decision: checks channel opt-in, per-type threshold, and quiet hours.
   * `value`, when provided, is compared against the user's configured threshold for `type`
   * (e.g. a signal score) — the notification is suppressed if it falls below the threshold.
   * Quiet hours suppress everything except systemAlerts.
   */
  async shouldDeliver(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
    value?: number,
  ): Promise<boolean> {
    const preference = await this.findOrCreate(userId);

    if (!this.channelMap(preference)[type][channel]) {
      return false;
    }

    const threshold = preference.thresholds?.[type];
    if (threshold !== undefined && value !== undefined && value < threshold) {
      return false;
    }

    if (type !== 'systemAlerts' && this.isWithinQuietHours(preference)) {
      return false;
    }

    return true;
  }

  private channelMap(
    preference: NotificationPreference,
  ): Record<NotificationType, Record<NotificationChannel, boolean>> {
    return {
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
  }

  private isWithinQuietHours(
    preference: NotificationPreference,
    at: Date = new Date(),
  ): boolean {
    if (
      !preference.quietHoursEnabled ||
      !preference.quietHoursStart ||
      !preference.quietHoursEnd
    ) {
      return false;
    }

    const minutesNow = this.minutesInTimezone(at, preference.timezone);
    const start = this.toMinutes(preference.quietHoursStart);
    const end = this.toMinutes(preference.quietHoursEnd);

    if (start === end) return true;
    if (start < end) {
      return minutesNow >= start && minutesNow < end;
    }
    // Wraps past midnight, e.g. 22:00 -> 07:00
    return minutesNow >= start || minutesNow < end;
  }

  private toMinutes(hhmm: string): number {
    const [hours, minutes] = hhmm.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private minutesInTimezone(at: Date, timezone: string): number {
    try {
      const formatted = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(at);
      return this.toMinutes(formatted);
    } catch {
      return at.getUTCHours() * 60 + at.getUTCMinutes();
    }
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
      quietHours: {
        enabled: preference.quietHoursEnabled,
        start: preference.quietHoursStart,
        end: preference.quietHoursEnd,
        timezone: preference.timezone,
      },
      thresholds: preference.thresholds || {},
      updatedAt: preference.updatedAt,
    };
  }
}
