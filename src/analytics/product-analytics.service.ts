import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { OnEvent } from '@nestjs/event-emitter';

import { MixpanelProvider } from './providers/mixpanel.provider';
import { AmplitudeProvider } from './providers/amplitude.provider';
import {
  ANALYTICS_EVENTS,
  AnalyticsEventName,
  UserProperties,
  UserRegisteredProperties,
  WalletConnectedProperties,
  FeedViewedProperties,
  SignalViewedProperties,
  SignalCopiedProperties,
  SignalCreatedProperties,
  TradeExecutedProperties,
  TradeConfirmedProperties,
  TradeFailedProperties,
  ProviderFollowedProperties,
  SettingsUpdatedProperties,
  KycStartedProperties,
  KycCompletedProperties,
  SubscriptionUpgradedProperties,
  SearchPerformedProperties,
} from './events/event-definitions';

export type AnalyticsProvider = 'mixpanel' | 'amplitude' | 'all';

export interface TrackOptions {
  /** Optionally override which provider to send to */
  provider?: AnalyticsProvider;
  /** Event timestamp (defaults to now) */
  timestamp?: Date;
  /** Client context */
  context?: {
    platform?: 'web' | 'ios' | 'android';
    appVersion?: string;
    sessionId?: string;
    language?: string;
  };
}

/** Redis key for opt-out flags */
const OPT_OUT_KEY = (userId: string) => `analytics:opt_out:${userId}`;
const USER_PROPS_KEY = (userId: string) => `analytics:user_props:${userId}`;

@Injectable()
export class ProductAnalyticsService {
  private readonly logger = new Logger(ProductAnalyticsService.name);
  private readonly defaultProvider: AnalyticsProvider;

  constructor(
    private readonly mixpanel: MixpanelProvider,
    private readonly amplitude: AmplitudeProvider,
    @InjectRedis() private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.defaultProvider = this.config.get<AnalyticsProvider>(
      'ANALYTICS_DEFAULT_PROVIDER',
      'all',
    );
  }

  // ─── Core track method ────────────────────────────────────────────────────

  async track(
    userId: string,
    eventName: AnalyticsEventName | string,
    properties: Record<string, unknown> = {},
    options: TrackOptions = {},
  ): Promise<void> {
    // Check opt-out before sending anything
    if (await this.isOptedOut(userId)) {
      this.logger.debug(
        `Analytics opt-out: skipping event "${eventName}" for user ${userId}`,
      );
      return;
    }

    const enriched = {
      ...properties,
      platform: options.context?.platform,
      app_version: options.context?.appVersion,
      session_id: options.context?.sessionId,
    };

    const provider = options.provider ?? this.defaultProvider;

    try {
      if (provider === 'mixpanel' || provider === 'all') {
        this.mixpanel.track(userId, eventName, enriched, options.timestamp);
      }
      if (provider === 'amplitude' || provider === 'all') {
        this.amplitude.track(
          userId,
          eventName,
          enriched,
          options.timestamp,
          options.context,
        );
      }
    } catch (err) {
      // Never let analytics failures propagate to callers
      this.logger.error(`Analytics track failed: ${(err as Error).message}`);
    }
  }

  // ─── Update User Properties ───────────────────────────────────────────────

  async setUserProperties(
    userId: string,
    properties: Partial<UserProperties>,
  ): Promise<void> {
    if (await this.isOptedOut(userId)) return;

    try {
      // Cache properties in Redis for cohort logic
      await this.redis.hset(
        USER_PROPS_KEY(userId),
        properties as Record<string, string>,
      );
      await this.redis.expire(USER_PROPS_KEY(userId), 90 * 24 * 60 * 60); // 90 days

      await Promise.allSettled([
        this.mixpanel.setUserProperties(userId, properties),
        this.amplitude.setUserProperties(userId, properties),
      ]);
    } catch (err) {
      this.logger.error(
        `Analytics setUserProperties failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── Strongly-typed event helpers ─────────────────────────────────────────

  async trackUserRegistered(
    userId: string,
    props: UserRegisteredProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.USER_REGISTERED,
      props as any,
      options,
    );
    // Set initial user properties on registration
    await this.setUserProperties(userId, {
      account_age_days: 0,
      total_trades: 0,
      kyc_level: 0,
      subscription_tier: 'free',
      followed_providers_count: 0,
      has_wallet: false,
      analytics_opt_out: false,
    });
  }

  async trackWalletConnected(
    userId: string,
    props: WalletConnectedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.WALLET_CONNECTED,
      props as any,
      options,
    );
    if (props.is_first_wallet) {
      await this.setUserProperties(userId, { has_wallet: true });
    }
  }

  async trackFeedViewed(
    userId: string,
    props: FeedViewedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.FEED_VIEWED,
      props as any,
      options,
    );
  }

  async trackSignalViewed(
    userId: string,
    props: SignalViewedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.SIGNAL_VIEWED,
      props as any,
      options,
    );
  }

  async trackSignalCopied(
    userId: string,
    props: SignalCopiedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.SIGNAL_COPIED,
      props as any,
      options,
    );
  }

  async trackSignalCreated(
    userId: string,
    props: SignalCreatedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.SIGNAL_CREATED,
      props as any,
      options,
    );
  }

  async trackTradeExecuted(
    userId: string,
    props: TradeExecutedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.TRADE_EXECUTED,
      props as any,
      options,
    );
    // Increment trade counter on both platforms
    try {
      await this.amplitude.incrementUserProperty(userId, 'total_trades', 1);
    } catch {
      /* non-critical */
    }
  }

  async trackTradeConfirmed(
    userId: string,
    props: TradeConfirmedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.TRADE_CONFIRMED,
      props as any,
      options,
    );
  }

  async trackTradeFailed(
    userId: string,
    props: TradeFailedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.TRADE_FAILED,
      props as any,
      options,
    );
  }

  async trackProviderFollowed(
    userId: string,
    props: ProviderFollowedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.PROVIDER_FOLLOWED,
      props as any,
      options,
    );
  }

  async trackSettingsUpdated(
    userId: string,
    props: SettingsUpdatedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.SETTINGS_UPDATED,
      props as any,
      options,
    );
  }

  async trackKycStarted(
    userId: string,
    props: KycStartedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.KYC_STARTED,
      props as any,
      options,
    );
  }

  async trackKycCompleted(
    userId: string,
    props: KycCompletedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.KYC_COMPLETED,
      props as any,
      options,
    );
    await this.setUserProperties(userId, { kyc_level: props.level_achieved });
  }

  async trackSubscriptionUpgraded(
    userId: string,
    props: SubscriptionUpgradedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.SUBSCRIPTION_UPGRADED,
      props as any,
      options,
    );
    await this.setUserProperties(userId, {
      subscription_tier: props.to_tier as any,
    });
  }

  async trackSearchPerformed(
    userId: string,
    props: SearchPerformedProperties,
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.SEARCH_PERFORMED,
      props as any,
      options,
    );
  }

  async trackUserLoggedIn(
    userId: string,
    props: { method: string; platform?: string },
    options?: TrackOptions,
  ) {
    await this.track(
      userId,
      ANALYTICS_EVENTS.USER_LOGGED_IN,
      props as any,
      options,
    );
    // Refresh account_age_days on each login
    const ageData = await this.redis.hget(
      USER_PROPS_KEY(userId),
      'account_created_at',
    );
    if (ageData) {
      const ageDays = Math.floor(
        (Date.now() - parseInt(ageData, 10)) / (24 * 60 * 60 * 1000),
      );
      await this.setUserProperties(userId, { account_age_days: ageDays });
    }
  }

  // ─── GDPR Opt-out / Opt-in ────────────────────────────────────────────────

  async optOut(userId: string): Promise<void> {
    await this.redis.set(
      OPT_OUT_KEY(userId),
      '1',
      'EX',
      5 * 365 * 24 * 60 * 60,
    );
    await Promise.allSettled([
      this.mixpanel.optOut(userId),
      this.amplitude.optOut(userId),
    ]);
    this.logger.log(`Analytics: user ${userId} opted out`);
  }

  async optIn(userId: string): Promise<void> {
    await this.redis.del(OPT_OUT_KEY(userId));
    await this.setUserProperties(userId, { analytics_opt_out: false });
    this.logger.log(`Analytics: user ${userId} opted in`);
  }

  async isOptedOut(userId: string): Promise<boolean> {
    const flag = await this.redis.get(OPT_OUT_KEY(userId));
    return flag === '1';
  }

  // ─── Flush all buffers (called on shutdown) ───────────────────────────────

  async flush(): Promise<void> {
    await Promise.allSettled([this.mixpanel.flush(), this.amplitude.flush()]);
  }

  // ─── Event-driven listeners (from other modules) ──────────────────────────

  /** Auto-track KYC events emitted by KycService */
  @OnEvent('kyc.initiated')
  async onKycInitiated(payload: {
    userId: string;
    level: number;
    verificationId: string;
  }) {
    await this.trackKycStarted(payload.userId, {
      target_level: payload.level as 1 | 2,
      provider: 'persona',
    });
  }

  @OnEvent('kyc.approved')
  async onKycApproved(payload: {
    userId: string;
    level: number;
    verificationId: string;
    expiresAt?: Date;
  }) {
    await this.trackKycCompleted(payload.userId, {
      level_achieved: payload.level as 1 | 2,
      time_to_complete_minutes: 0, // set actual value when you have started_at
    });
  }
}
