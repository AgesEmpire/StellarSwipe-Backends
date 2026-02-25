import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AnalyticsEventName,
  UserProperties,
} from '../events/event-definitions';

export interface MixpanelEvent {
  event: string;
  properties: Record<string, unknown> & {
    distinct_id: string;
    time?: number;
    $insert_id?: string;
    token?: string;
  };
}

export interface MixpanelProfileUpdate {
  $token: string;
  $distinct_id: string;
  $set: Partial<Record<string, unknown>>;
}

/**
 * Mixpanel Provider
 *
 * Docs: https://developer.mixpanel.com/reference/ingestion-api
 *
 * Required env vars:
 *   MIXPANEL_TOKEN          - your Mixpanel project token
 *   MIXPANEL_API_SECRET     - used for server-side imports (optional, for EU residency)
 *   MIXPANEL_EU_RESIDENCY   - 'true' to route to EU endpoint
 *   MIXPANEL_ENABLED        - 'false' to disable (useful in test envs)
 */
@Injectable()
export class MixpanelProvider {
  private readonly logger = new Logger(MixpanelProvider.name);
  private readonly token: string;
  private readonly enabled: boolean;
  private readonly trackUrl: string;
  private readonly engageUrl: string;

  /** In-memory batch queue — flushed every BATCH_INTERVAL_MS or when full */
  private readonly eventQueue: MixpanelEvent[] = [];
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_INTERVAL_MS = 5_000;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('MIXPANEL_TOKEN', '');
    this.enabled =
      this.config.get<string>('MIXPANEL_ENABLED', 'true') !== 'false' &&
      !!this.token;

    const isEu =
      this.config.get<string>('MIXPANEL_EU_RESIDENCY', 'false') === 'true';
    const base = isEu
      ? 'https://api-eu.mixpanel.com'
      : 'https://api.mixpanel.com';
    this.trackUrl = `${base}/track`;
    this.engageUrl = `${base}/engage`;

    if (this.enabled) {
      this.logger.log(`Mixpanel enabled (EU: ${isEu})`);
      this.scheduleFlush();
    } else {
      this.logger.warn('Mixpanel disabled — events will be dropped');
    }
  }

  // ─── Track Event ──────────────────────────────────────────────────────────

  track(
    userId: string,
    eventName: AnalyticsEventName | string,
    properties: Record<string, unknown> = {},
    timestamp?: Date,
  ): void {
    if (!this.enabled) return;

    const event: MixpanelEvent = {
      event: eventName,
      properties: {
        distinct_id: userId,
        token: this.token,
        time: Math.floor((timestamp ?? new Date()).getTime() / 1000),
        $insert_id: `${userId}-${eventName}-${Date.now()}`,
        ...properties,
      },
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
  ): Promise<void> {
    if (!this.enabled) return;

    const payload: MixpanelProfileUpdate = {
      $token: this.token,
      $distinct_id: userId,
      $set: properties as Record<string, unknown>,
    };

    await this.sendEngage([payload]);
  }

  // ─── Alias (link anonymous → authenticated) ──────────────────────────────

  async alias(anonymousId: string, userId: string): Promise<void> {
    if (!this.enabled) return;

    await this.sendToMixpanel(this.trackUrl, [
      {
        event: '$create_alias',
        properties: {
          distinct_id: anonymousId,
          alias: userId,
          token: this.token,
        },
      },
    ]);
  }

  // ─── Opt Out (GDPR) ──────────────────────────────────────────────────────

  async optOut(userId: string): Promise<void> {
    if (!this.enabled) return;

    // Delete the profile from Mixpanel
    await this.sendEngage([
      {
        $token: this.token,
        $distinct_id: userId,
        $delete: '',
        $ignore_alias: true,
      } as any,
    ]);

    this.logger.log(`Mixpanel: opted out user ${userId} and deleted profile`);
  }

  // ─── Flush queue manually ─────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const batch = this.eventQueue.splice(0, this.BATCH_SIZE);
    await this.sendToMixpanel(this.trackUrl, batch);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private scheduleFlush(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.BATCH_INTERVAL_MS);

    // Don't keep the process alive for analytics flushing
    this.flushTimer.unref?.();
  }

  private async sendToMixpanel(url: string, data: unknown[]): Promise<void> {
    if (data.length === 0) return;

    try {
      const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
      const body = new URLSearchParams({ data: encoded, verbose: '1' });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      const result = await response.json().catch(() => ({}));
      if ((result as any).status !== 1) {
        this.logger.warn(
          `Mixpanel ingestion warning: ${JSON.stringify(result)}`,
        );
      }
    } catch (err) {
      // Fail silently — analytics downtime must never affect product
      this.logger.error(`Mixpanel send failed: ${(err as Error).message}`);
    }
  }

  private async sendEngage(profiles: unknown[]): Promise<void> {
    await this.sendToMixpanel(this.engageUrl, profiles);
  }
}
