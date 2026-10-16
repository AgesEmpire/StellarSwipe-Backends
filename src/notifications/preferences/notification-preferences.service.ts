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

/**
 * Immutable audit event describing a change to a user's notification
 * delivery preferences or consent settings.
 *
 * Only the names of changed fields are recorded — never the values — so that
 * sensitive consent data is excluded from the audit trail.
 */
export interface PreferenceAuditEvent {
  readonly userId: string;
  readonly actor: string;
  readonly timestamp: Date;
  readonly changedFields: readonly string[];
}

@Injectable()
export class NotificationPreferencesService {
  private readonly auditTrail: PreferenceAuditEvent[] = [];

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
   * Emits an immutable audit event capturing the actor, timestamp and the
   * set of changed fields (values are never recorded).
   */
  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
    actor: string = userId,
  ): Promise<PreferenceDto> {
    const preference = await this.findOrCreate(userId);
    const changedFields: string[] = [];

    if (dto.tradeUpdates !== undefined) {
      if (dto.tradeUpdates.email !== undefined) {
        if (preference.tradeUpdatesEmail !== dto.tradeUpdates.email) {
          changedFields.push('tradeUpdates.email');
        }
        preference.tradeUpdatesEmail = dto.tradeUpdates.email;
      }
      if (dto.tradeUpdates.push !== undefined) {
        if (preference.tradeUpdatesPush !== dto.tradeUpdates.push) {
          changedFields.push('tradeUpdates.push');
        }
        preference.tradeUpdatesPush = dto.tradeUpdates.push;
      }
    }

    if (dto.signalPerformance !== undefined) {
      if (dto.signalPerformance.email !== undefined) {
        if (preference.signalPerformanceEmail !== dto.signalPerformance.email) {
          changedFields.push('signalPerformance.email');
        }
        preference.signalPerformanceEmail = dto.signalPerformance.email;
      }
      if (dto.signalPerformance.push !== undefined) {
        if (preference.signalPerformancePush !== dto.signalPerformance.push) {
          changedFields.push('signalPerformance.push');
        }
        preference.signalPerformancePush = dto.signalPerformance.push;
      }
    }

    if (dto.systemAlerts !== undefined) {
      if (dto.systemAlerts.email !== undefined) {
        if (preference.systemAlertsEmail !== dto.systemAlerts.email) {
          changedFields.push('systemAlerts.email');
        }
        preference.systemAlertsEmail = dto.systemAlerts.email;
      }
      if (dto.systemAlerts.push !== undefined) {
        if (preference.systemAlertsPush !== dto.systemAlerts.push) {
          changedFields.push('systemAlerts.push');
        }
        preference.systemAlertsPush = dto.systemAlerts.push;
      }
    }

    if (dto.marketing !== undefined) {
      if (dto.marketing.email !== undefined) {
        if (preference.marketingEmail !== dto.marketing.email) {
          changedFields.push('marketing.email');
        }
        preference.marketingEmail = dto.marketing.email;
      }
      if (dto.marketing.push !== undefined) {
        if (preference.marketingPush !== dto.marketing.push) {
          changedFields.push('marketing.push');
        }
        preference.marketingPush = dto.marketing.push;
      }
    }

    const saved = await this.preferenceRepository.save(preference);

    if (changedFields.length > 0) {
      this.recordAuditEvent(userId, actor, changedFields);
    }

    return this.toDto(saved);
  }

  /**
   * Retrieve the immutable audit trail of preference changes for a user.
   */
  getAuditTrail(userId: string): readonly PreferenceAuditEvent[] {
    return this.auditTrail.filter((event) => event.userId === userId);
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
    actor: string = userId,
  ): Promise<PreferenceDto> {
    const dto: UpdatePreferencesDto = {
      [type]: { [channel]: false },
    };
    return this.updatePreferences(userId, dto, actor);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private recordAuditEvent(
    userId: string,
    actor: string,
    changedFields: string[],
  ): void {
    this.auditTrail.push(
      Object.freeze({
        userId,
        actor,
        timestamp: new Date(),
        changedFields: Object.freeze([...changedFields]),
      }),
    );
  }

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
