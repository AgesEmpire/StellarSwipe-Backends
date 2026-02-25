/**
 * Product Analytics — Event Definitions
 *
 * Single source of truth for every tracked event in StellarSwipe.
 * All event names, property shapes, and funnel membership are defined here.
 *
 * Rules:
 *  1. No PII — no email, phone, full name, or wallet private keys
 *  2. Use snake_case for property keys (Mixpanel/Amplitude convention)
 *  3. Add JSDoc for every event so it appears in IDE autocomplete
 *  4. Keep amounts as raw numbers (USD equivalent) — never crypto strings
 */

// ─── Event Name Constants ─────────────────────────────────────────────────

export const ANALYTICS_EVENTS = {
  // ── Auth & Onboarding ───────────────────────────────────────────────────
  /** User completes registration */
  USER_REGISTERED: 'User Registered',
  /** User connects a Stellar wallet */
  WALLET_CONNECTED: 'Wallet Connected',
  /** User completes the onboarding tutorial */
  ONBOARDING_COMPLETED: 'Onboarding Completed',
  /** User logs in */
  USER_LOGGED_IN: 'User Logged In',
  /** User logs out */
  USER_LOGGED_OUT: 'User Logged Out',

  // ── Signals & Feed ──────────────────────────────────────────────────────
  /** User views the main signal feed */
  FEED_VIEWED: 'Feed Viewed',
  /** User opens a signal detail */
  SIGNAL_VIEWED: 'Signal Viewed',
  /** User copies/follows a signal trade */
  SIGNAL_COPIED: 'Signal Copied',
  /** Provider publishes a new signal */
  SIGNAL_CREATED: 'Signal Created',

  // ── Trades ─────────────────────────────────────────────────────────────
  /** User executes a trade */
  TRADE_EXECUTED: 'Trade Executed',
  /** Trade is confirmed on-chain */
  TRADE_CONFIRMED: 'Trade Confirmed',
  /** Trade fails or is rejected */
  TRADE_FAILED: 'Trade Failed',

  // ── Providers ──────────────────────────────────────────────────────────
  /** User follows a signal provider */
  PROVIDER_FOLLOWED: 'Provider Followed',
  /** User unfollows a signal provider */
  PROVIDER_UNFOLLOWED: 'Provider Unfollowed',
  /** User views a provider profile */
  PROVIDER_VIEWED: 'Provider Viewed',

  // ── Portfolio & Settings ────────────────────────────────────────────────
  /** User views their portfolio */
  PORTFOLIO_VIEWED: 'Portfolio Viewed',
  /** User updates account settings */
  SETTINGS_UPDATED: 'Settings Updated',
  /** User updates notification preferences */
  NOTIFICATIONS_CONFIGURED: 'Notifications Configured',

  // ── KYC ────────────────────────────────────────────────────────────────
  /** User starts the KYC flow */
  KYC_STARTED: 'KYC Started',
  /** User completes KYC verification */
  KYC_COMPLETED: 'KYC Completed',

  // ── Revenue & Monetisation ──────────────────────────────────────────────
  /** User upgrades subscription tier */
  SUBSCRIPTION_UPGRADED: 'Subscription Upgraded',
  /** User views pricing page */
  PRICING_VIEWED: 'Pricing Viewed',

  // ── Search & Discovery ──────────────────────────────────────────────────
  /** User performs a search */
  SEARCH_PERFORMED: 'Search Performed',
  /** User applies a filter on the feed */
  FILTER_APPLIED: 'Filter Applied',
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

// ─── Event Property Types ─────────────────────────────────────────────────

/** Base properties present on every event */
export interface BaseEventProperties {
  platform?: 'web' | 'ios' | 'android';
  app_version?: string;
  session_id?: string;
}

export interface UserRegisteredProperties extends BaseEventProperties {
  registration_method: 'email' | 'google' | 'wallet';
  referral_code?: string;
}

export interface WalletConnectedProperties extends BaseEventProperties {
  wallet_type: string; // e.g. 'freighter', 'albedo', 'xbull'
  network: 'testnet' | 'mainnet';
  is_first_wallet: boolean;
}

export interface FeedViewedProperties extends BaseEventProperties {
  filter_active: boolean;
  filter_asset?: string;
  signals_count: number;
}

export interface SignalViewedProperties extends BaseEventProperties {
  signal_id: string;
  provider_id: string; // anonymised provider ref
  asset_pair: string; // e.g. 'XLM/USDC'
  signal_age_minutes: number;
  source: 'feed' | 'notification' | 'direct_link';
}

export interface SignalCopiedProperties extends BaseEventProperties {
  signal_id: string;
  provider_id: string;
  asset_pair: string;
  order_type: 'market' | 'limit';
  time_to_copy_seconds: number; // seconds from signal view to copy
}

export interface SignalCreatedProperties extends BaseEventProperties {
  asset_pair: string;
  order_type: 'market' | 'limit';
  signal_type: 'buy' | 'sell';
}

export interface TradeExecutedProperties extends BaseEventProperties {
  asset_pair: string;
  order_type: 'market' | 'limit';
  amount_usd: number;
  signal_provider_id?: string;
  execution_time_ms: number;
  is_first_trade: boolean;
  slippage_bps?: number; // basis points
}

export interface TradeConfirmedProperties extends BaseEventProperties {
  asset_pair: string;
  amount_usd: number;
  confirmation_time_ms: number;
  fee_usd: number;
}

export interface TradeFailedProperties extends BaseEventProperties {
  asset_pair: string;
  amount_usd: number;
  failure_reason: string;
}

export interface ProviderFollowedProperties extends BaseEventProperties {
  provider_id: string;
  provider_tier: string;
  follower_count: number; // provider's follower count at time of follow
  source: 'profile' | 'feed' | 'signal_detail';
}

export interface SettingsUpdatedProperties extends BaseEventProperties {
  settings_section:
    | 'profile'
    | 'security'
    | 'notifications'
    | 'trading'
    | 'privacy';
  fields_updated: string[]; // field names, not values
}

export interface KycStartedProperties extends BaseEventProperties {
  target_level: 1 | 2;
  provider: 'persona' | 'onfido';
}

export interface KycCompletedProperties extends BaseEventProperties {
  level_achieved: 1 | 2;
  time_to_complete_minutes: number;
}

export interface SubscriptionUpgradedProperties extends BaseEventProperties {
  from_tier: string;
  to_tier: string;
  billing_period: 'monthly' | 'annual';
}

export interface SearchPerformedProperties extends BaseEventProperties {
  query_length: number; // length, not content
  results_count: number;
  search_context: 'providers' | 'signals' | 'assets';
}

// ─── User Properties (set once and updated) ──────────────────────────────

export interface UserProperties {
  /** Days since account creation */
  account_age_days: number;
  /** Total number of completed trades */
  total_trades: number;
  /** Top traded asset pair */
  preferred_asset?: string;
  /** User's self-reported risk profile */
  risk_profile?: 'conservative' | 'moderate' | 'aggressive';
  /** Current KYC level (0, 1, or 2) */
  kyc_level: 0 | 1 | 2;
  /** Subscription tier */
  subscription_tier: 'free' | 'basic' | 'pro';
  /** Number of providers the user follows */
  followed_providers_count: number;
  /** Whether user has connected a wallet */
  has_wallet: boolean;
  /** User's preferred UI language */
  language?: string;
  /** Whether user has opted out of analytics */
  analytics_opt_out: boolean;
}

// ─── Funnel Definitions ───────────────────────────────────────────────────

export const FUNNELS = {
  /**
   * Onboarding funnel: tracks user journey from registration to first trade
   */
  ONBOARDING: {
    name: 'Onboarding Funnel',
    steps: [
      ANALYTICS_EVENTS.USER_REGISTERED,
      ANALYTICS_EVENTS.WALLET_CONNECTED,
      ANALYTICS_EVENTS.FEED_VIEWED,
      ANALYTICS_EVENTS.TRADE_EXECUTED,
    ],
  },

  /**
   * Engagement funnel: daily active user engagement depth
   */
  ENGAGEMENT: {
    name: 'Engagement Funnel',
    steps: [
      ANALYTICS_EVENTS.USER_LOGGED_IN,
      ANALYTICS_EVENTS.FEED_VIEWED,
      ANALYTICS_EVENTS.SIGNAL_VIEWED,
      ANALYTICS_EVENTS.TRADE_EXECUTED,
    ],
  },

  /**
   * Signal-to-trade funnel: conversion rate of signal views to trades
   */
  SIGNAL_TO_TRADE: {
    name: 'Signal-to-Trade Funnel',
    steps: [
      ANALYTICS_EVENTS.SIGNAL_VIEWED,
      ANALYTICS_EVENTS.SIGNAL_COPIED,
      ANALYTICS_EVENTS.TRADE_EXECUTED,
    ],
  },

  /**
   * Provider funnel: signal provider lifecycle
   */
  PROVIDER: {
    name: 'Provider Funnel',
    steps: [
      ANALYTICS_EVENTS.SIGNAL_CREATED,
      ANALYTICS_EVENTS.SIGNAL_VIEWED,
      ANALYTICS_EVENTS.SIGNAL_COPIED,
      ANALYTICS_EVENTS.PROVIDER_FOLLOWED,
    ],
  },

  /**
   * KYC conversion funnel
   */
  KYC_CONVERSION: {
    name: 'KYC Conversion Funnel',
    steps: [
      ANALYTICS_EVENTS.KYC_STARTED,
      ANALYTICS_EVENTS.KYC_COMPLETED,
      ANALYTICS_EVENTS.TRADE_EXECUTED,
    ],
  },
} as const;

// ─── Cohort Definitions ───────────────────────────────────────────────────

export const COHORTS = {
  /** Users who traded within 24h of registration */
  FAST_CONVERTERS: 'fast_converters',
  /** Users who copied at least 3 signals in first week */
  SIGNAL_COPIERS: 'signal_copiers',
  /** Users who follow 5+ providers */
  POWER_FOLLOWERS: 'power_followers',
  /** Users with Level 2 KYC */
  KYC_VERIFIED: 'kyc_verified',
  /** Users who traded this week */
  WEEKLY_ACTIVE_TRADERS: 'weekly_active_traders',
} as const;
