import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

/**
 * Sentry error tracking service
 * Captures exceptions and performance data
 */
@Injectable()
export class SentryService {
  private isInitialized = false;

  constructor(private readonly configService: ConfigService) { }

  /**
   * Initialize Sentry with configuration
   * Should be called early in application bootstrap
   */
  init(): void {
    const dsn = this.configService.get<string>('sentry.dsn');

    if (!dsn) {
      console.warn(
        '⚠️  Sentry DSN not configured. Error tracking is disabled. ' +
        'Set SENTRY_DSN environment variable to enable Sentry.',
      );
      return;
    }

    const environment = this.configService.get<string>(
      'sentry.environment',
      'development',
    );
    const tracesSampleRate = this.configService.get<number>(
      'sentry.tracesSampleRate',
      0.1,
    );

    Sentry.init({
      dsn,
      environment,
      tracesSampleRate,
      integrations: [nodeProfilingIntegration()],
      // Don't send sensitive data
      beforeSend(event: Sentry.ErrorEvent) {
        // Remove sensitive headers
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        return event;
      },
    });

    this.isInitialized = true;
    console.log(`✅ Sentry initialized for environment: ${environment}`);
  }

  /**
   * Capture an exception
   */
  captureException(exception: Error, context?: Record<string, any>): void {
    if (!this.isInitialized) {
      return;
    }

    Sentry.captureException(exception, {
      extra: context,
    });
  }

  /**
   * Capture a message
   */
  captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
    if (!this.isInitialized) {
      return;
    }

    Sentry.captureMessage(message, level);
  }

  /**
   * Set user context
   */
  setUser(user: { id: string; email?: string; username?: string }): void {
    if (!this.isInitialized) {
      return;
    }

    Sentry.setUser(user);
  }

  /**
   * Clear user context
   */
  clearUser(): void {
    if (!this.isInitialized) {
      return;
    }

    Sentry.setUser(null);
  }

  /**
   * Add breadcrumb for debugging
   */
  addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
    if (!this.isInitialized) {
      return;
    }

    Sentry.addBreadcrumb(breadcrumb);
  }

  /**
   * Set custom context
   */
  setContext(name: string, context: Record<string, any>): void {
    if (!this.isInitialized) {
      return;
    }

    Sentry.setContext(name, context);
  }

  /**
   * Set tag
   */
  setTag(key: string, value: string): void {
    if (!this.isInitialized) {
      return;
    }

    Sentry.setTag(key, value);
  }

  /**
   * Flush pending events (useful before shutdown)
   */
  async flush(timeout = 2000): Promise<boolean> {
    if (!this.isInitialized) {
      return true;
    }

    return Sentry.flush(timeout);
  }
}
