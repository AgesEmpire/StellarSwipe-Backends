import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AnalyticsEventName,
  UserProperties,
} from '../events/event-definitions';
import * as crypto from 'crypto';

export interface AmplitudeEvent {
  user_id: string;
  event_type: string;
  event_properties?: Record<string, unknown>;
  user_properties?: Record<string, unknown>;
  time?: number; // Unix timestamp in milliseconds
  insert_id?: string; // Dedup ID
  app_version?: string;
  platform?: string;
  os_name?: string;
  language?: string;
  ip?: string; // Used for geo enrichment — not stored by default
}

export interface AmplitudeIdentifyUpdate {
  user_id: string;
  user_properties: {
    $set?: Record<string, unknown>;
    $setOnce?: Record<string, unknown>;
    $add?: Record<string, number>;
    $unset?: Record<string, '-'>;
  };
}

/**
 * Amplitude Provider
 *
 * Docs: https://www.docs.developers.amplitude.com/analytics/apis/http-v2-api/
 *
 * Required env vars:
 *   AMPLITUDE_API_KEY       - your Amplitude API key
 *   AMPLITUDE_SECRET_KEY    - for server-side exports (optional)
 *   AMPLITUDE_EU_RESIDENCY  - 'true' to route to EU endpoint
 *   AMPLITUDE_ENABLED       - 'false' to disable
 */
@Injectable()
export class AmplitudeProvider {
  private readonly logger = new Logger(AmplitudeProvider.name);
  private readonly apiKey: string;
  private readonly enabled: boolean;
  private readonly trackUrl: string;
  private readonly identifyUrl: string;

  private readonly eventQueue: AmplitudeEvent[] = [];
  private readonly BATCH_SIZE = 100; // Amplitude supports 100/batch
  private readonly BATCH_INTERVAL_MS = 5_000;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('AMPLITUDE_API_KEY', '');
    this.enabled =
      this.config.get<string>('AMPLITUDE_ENABLED', 'true') !== 'false' &&
      !!this.apiKey;

    const isEu =
      this.config.get<string>('AMPLITUDE_EU_RESIDENCY', 'false') === 'true';
    const base = isEu
      ? 'https://api.eu.amplitude.com'
      : 'https://api2.amplitude.com';
    this.trackUrl = `${base}/2/httpapi`;
    this.identifyUrl = `${base}/identify`;

    if (this.enabled) {
      this.logger.log(`Amplitude enabled (EU: ${isEu})`);
      this.scheduleFlush();
    } else {
      this.logger.warn('Amplitude disabled — events will be dropped');
    }
  }

  // ─── Track Event ──────────────────────────────────────────────────────────

  track(
    userId: string,
    eventName: AnalyticsEventName | string,
    properties: Record<string, unknown> = {},
    timestamp?: Date,
    context?: { platform?: string; appVersion?: string; language?: string },
  ): void {
    if (!this.enabled) return;

    const event: AmplitudeEvent = {
      user_id: userId,
      event_type: eventName,
      event_properties: properties,
      time: (timestamp ?? new Date()).getTime(),
      // Deterministic insert_id for deduplication
      insert_id: crypto
        .createHash('sha256')
        .update(`${userId}-${eventName}-${Date.now()}`)
        .digest('hex')
        .slice(0, 36),
      platform: context?.platform,
      app_version: context?.appVersion,
      language: context?.language,
    };

    this.eventQueue.push(event);
    if (this.eventQueue.length >= this.BATCH_SIZE) {
      void this.flush();
    }
  }

  // ─── Set User Properties ──────────────────────────────────────────────────

  async setUserProperties(
    userId: string,
    properties: Partial<UserProperties>,
    incrementFields?: Partial<Record<keyof UserProperties, number>>,
  ): Promise<void> {
    if (!this.enabled) return;

    const update: AmplitudeIdentifyUpdate = {
      user_id: userId,
      user_properties: {
        $set: properties as Record<string, unknown>,
        ...(incrementFields
          ? { $add: incrementFields as Record<string, number> }
          : {}),
      },
    };

    await this.sendIdentify([update]);
  }

  // ─── Increment a Counter Property ────────────────────────────────────────

  async incrementUserProperty(
    userId: string,
    field: keyof UserProperties,
    by = 1,
  ): Promise<void> {
    if (!this.enabled) return;

    await this.sendIdentify([
      {
        user_id: userId,
        user_properties: { $add: { [field]: by } },
      },
    ]);
  }

  // ─── Opt Out (GDPR) ──────────────────────────────────────────────────────

  async optOut(userId: string): Promise<void> {
    if (!this.enabled) return;

    // Amplitude: use the User Privacy API to delete user data
    // https://www.docs.developers.amplitude.com/analytics/apis/user-privacy-api/
    this.logger.log(
      `Amplitude: opt-out requested for user ${userId}. ` +
        `Submit a deletion request via Amplitude User Privacy API: ` +
        `POST https://amplitude.com/api/2/deletions/users`,
    );

    // Unset all custom properties on the profile
    await this.sendIdentify([
      {
        user_id: userId,
        user_properties: {
          $unset: {
            account_age_days: '-',
            total_trades: '-',
            preferred_asset: '-',
            risk_profile: '-',
            kyc_level: '-',
            subscription_tier: '-',
            followed_providers_count: '-',
          },
        },
      },
    ]);
  }

  // ─── Flush queue ─────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const batch = this.eventQueue.splice(0, this.BATCH_SIZE);
    await this.sendEvents(batch);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private scheduleFlush(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.BATCH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  private async sendEvents(events: AmplitudeEvent[]): Promise<void> {
    if (events.length === 0) return;
    try {
      const response = await fetch(this.trackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey, events }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn(`Amplitude track error ${response.status}: ${body}`);
      }
    } catch (err) {
      this.logger.error(`Amplitude send failed: ${(err as Error).message}`);
    }
  }

  private async sendIdentify(
    updates: AmplitudeIdentifyUpdate[],
  ): Promise<void> {
    if (updates.length === 0) return;
    try {
      const body = new URLSearchParams({
        api_key: this.apiKey,
        identification: JSON.stringify(updates),
      });

      await fetch(this.identifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error(`Amplitude identify failed: ${(err as Error).message}`);
    }
  }
}
