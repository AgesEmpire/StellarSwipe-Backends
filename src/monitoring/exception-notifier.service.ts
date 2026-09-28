import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { SentryService } from '../common/sentry';
import { PrometheusService } from './metrics/prometheus.service';
import { Counter, Gauge } from 'prom-client';

export interface ExceptionContext {
  path?: string;
  method?: string;
  userId?: string;
  requestId?: string;
  userAgent?: string;
  statusCode?: number;
  service?: string;
  [key: string]: unknown;
}

export interface NotificationChannel {
  name: string;
  enabled: boolean;
  notify(error: Error, context: ExceptionContext): Promise<void>;
}

export enum AlertSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

interface ThrottleEntry {
  count: number;
  firstSeen: number;
  lastNotified: number;
}

@Injectable()
export class ExceptionNotifierService implements OnModuleInit {
  private readonly logger = new Logger(ExceptionNotifierService.name);

  private readonly channels: NotificationChannel[] = [];
  private readonly throttleMap = new Map<string, ThrottleEntry>();

  // Prometheus counters
  private exceptionNotificationsTotal: Counter;
  private exceptionNotificationsThrottled: Counter;
  private unhandledExceptionsGauge: Gauge;

  private readonly isProd: boolean;
  private readonly throttleWindowMs: number;
  private readonly throttleMaxPerWindow: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly sentry: SentryService,
    private readonly prometheus: PrometheusService,
  ) {
    this.isProd = configService.get<string>('app.env', 'development') === 'production';
    // Suppress duplicate alerts: max 3 notifications per error per 5-minute window
    this.throttleWindowMs = 5 * 60 * 1000;
    this.throttleMaxPerWindow = 3;
  }

  onModuleInit(): void {
    this.exceptionNotificationsTotal = new Counter({
      name: 'exception_notifications_total',
      help: 'Total exception notifications sent',
      labelNames: ['severity', 'channel', 'error_type'],
      registers: [this.prometheus.registry],
    });

    this.exceptionNotificationsThrottled = new Counter({
      name: 'exception_notifications_throttled_total',
      help: 'Exception notifications suppressed by throttle',
      labelNames: ['error_type'],
      registers: [this.prometheus.registry],
    });

    this.unhandledExceptionsGauge = new Gauge({
      name: 'unhandled_exceptions_active',
      help: 'Number of distinct unhandled exception types seen since last reset',
      registers: [this.prometheus.registry],
    });

    // Prune throttle map every minute to avoid unbounded growth
    setInterval(() => this.pruneThrottleMap(), 60_000);
  }

  registerChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
    this.logger.log(`Notification channel registered: ${channel.name}`);
  }

  async notifyException(error: Error, context: ExceptionContext = {}): Promise<void> {
    const severity = this.classifySeverity(error, context);

    // Skip low-severity HTTP 4xx in production to avoid noise
    if (this.isProd && severity === AlertSeverity.LOW) {
      return;
    }

    const throttleKey = this.buildThrottleKey(error, context);
    if (this.isThrottled(throttleKey, error)) {
      return;
    }

    this.unhandledExceptionsGauge.inc();

    const enrichedContext: ExceptionContext = {
      ...context,
      severity,
      environment: this.configService.get<string>('app.env', 'development'),
      hostname: process.env.HOSTNAME ?? 'unknown',
      timestamp: new Date().toISOString(),
      errorMessage: error.message,
      errorStack: this.isProd ? undefined : error.stack,
    };

    // Sentry always receives critical/high production exceptions
    if (this.isProd && (severity === AlertSeverity.CRITICAL || severity === AlertSeverity.HIGH)) {
      this.sentry.captureException(error, enrichedContext);
    }

    await this.dispatchToChannels(error, enrichedContext, severity);
  }

  private async dispatchToChannels(
    error: Error,
    context: ExceptionContext,
    severity: AlertSeverity,
  ): Promise<void> {
    const activeChannels = this.channels.filter((c) => c.enabled);

    await Promise.allSettled(
      activeChannels.map(async (channel) => {
        try {
          await channel.notify(error, context);
          this.exceptionNotificationsTotal.inc({
            severity,
            channel: channel.name,
            error_type: error.name,
          });
        } catch (notifyError) {
          // Notification failure must never propagate into request handling
          this.logger.error(
            `Channel ${channel.name} failed to deliver notification`,
            notifyError instanceof Error ? notifyError.message : String(notifyError),
          );
        }
      }),
    );
  }

  private classifySeverity(error: Error, context: ExceptionContext): AlertSeverity {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status >= 500) return AlertSeverity.HIGH;
      if (status === 429) return AlertSeverity.MEDIUM;
      return AlertSeverity.LOW;
    }

    // Unhandled / unknown exceptions are always critical in production
    if (this.isProd) return AlertSeverity.CRITICAL;

    // TypeError, RangeError, etc. are high
    if (error instanceof TypeError || error instanceof RangeError) return AlertSeverity.HIGH;

    return AlertSeverity.MEDIUM;
  }

  private buildThrottleKey(error: Error, context: ExceptionContext): string {
    // Key on error type + endpoint so each distinct failure path is throttled independently
    return `${error.name}:${context.path ?? 'unknown'}:${context.statusCode ?? 0}`;
  }

  private isThrottled(key: string, error: Error): boolean {
    const now = Date.now();
    const entry = this.throttleMap.get(key);

    if (!entry) {
      this.throttleMap.set(key, { count: 1, firstSeen: now, lastNotified: now });
      return false;
    }

    // Reset window if expired
    if (now - entry.firstSeen > this.throttleWindowMs) {
      entry.count = 1;
      entry.firstSeen = now;
      entry.lastNotified = now;
      return false;
    }

    entry.count++;

    if (entry.count > this.throttleMaxPerWindow) {
      this.exceptionNotificationsThrottled.inc({ error_type: error.name });
      if (entry.count % 50 === 0) {
        // Periodic reminder so ops know the suppression is ongoing
        this.logger.warn(
          `Exception ${key} has occurred ${entry.count} times in this window — notifications throttled`,
        );
      }
      return true;
    }

    entry.lastNotified = now;
    return false;
  }

  private pruneThrottleMap(): void {
    const cutoff = Date.now() - this.throttleWindowMs * 2;
    for (const [key, entry] of this.throttleMap.entries()) {
      if (entry.firstSeen < cutoff) {
        this.throttleMap.delete(key);
      }
    }
  }

  resetThrottle(key?: string): void {
    if (key) {
      this.throttleMap.delete(key);
    } else {
      this.throttleMap.clear();
    }
    this.unhandledExceptionsGauge.set(0);
  }
}
