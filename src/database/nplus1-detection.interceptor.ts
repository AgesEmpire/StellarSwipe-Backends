// N+1 Detection Interceptor for NestJS
// Counts and times all database queries per request for N+1 detection in development mode

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ConfigService } from '@nestjs/config';
import { CorrelationIdStore } from '../correlation/correlation-id.store';
import { NPlusOneDetectedError, queryCounterStore } from './query-counter.store';

export interface NPlus1DetectionConfig {
  maxQueriesPerRequest: number;
  maxQueryTimeMs: number;
  logInProduction: boolean;
  repeatThreshold: number;
  allowlist: RegExp[];
  failOnDetect: boolean;
}

@Injectable()
export class NPlus1DetectionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(NPlus1DetectionInterceptor.name);
  private readonly config: NPlus1DetectionConfig;
  private readonly nodeEnv: string;

  constructor(
    configService: ConfigService,
    correlationIdStore: CorrelationIdStore,
  ) {
    this.config = {
      maxQueriesPerRequest: configService.get<number>('NPLUS1_MAX_QUERIES', 25),
      maxQueryTimeMs: configService.get<number>('NPLUS1_MAX_QUERY_TIME_MS', 1000),
      logInProduction: configService.get<boolean>('NPLUS1_LOG_IN_PRODUCTION', false),
      repeatThreshold: Number(configService.get('NPLUS1_REPEAT_THRESHOLD', 5)),
      allowlist: String(configService.get('NPLUS1_ALLOWLIST', '') ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => new RegExp(p)),
      failOnDetect: String(configService.get('NPLUS1_FAIL_ON_DETECT', 'false')) === 'true',
    };
    this.nodeEnv = process.env.NODE_ENV || 'development';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Covers both HTTP controllers and GraphQL resolvers.
    const request = context.switchToHttp().getRequest() ?? {};
    const url =
      request.url ?? `${context.getClass()?.name}.${context.getHandler()?.name}`;
    const method = request.method ?? context.getType();

    return queryCounterStore.run(
      { method, url },
      () => next.handle().pipe(
        tap({
          next: () => this.checkRepeated(url, method),
          complete: () => this.checkAndWarn(url, method),
          error: () => this.checkAndWarn(url, method),
        }),
      ),
    );
  }

  /** Flags repeated query shapes with their call site; throws when failOnDetect is set. */
  private checkRepeated(url: string, method: string): void {
    if (!this.config.failOnDetect && !this.shouldReport()) return;
    const route = `${method} ${url}`;
    if (this.config.allowlist.some((re) => re.test(route))) return;

    const offenders = queryCounterStore.repeated(
      this.config.repeatThreshold,
      this.config.allowlist,
    );
    if (!offenders.length) return;

    if (this.config.failOnDetect) throw new NPlusOneDetectedError(offenders);
    for (const q of offenders) {
      this.logger.warn(
        `N+1 on ${route}: ${q.count}x "${q.sql}"${q.callSite ? ` at ${q.callSite}` : ''}`,
      );
    }
  }

  private shouldReport(): boolean {
    if (this.nodeEnv === 'development') return true;
    if (this.nodeEnv === 'test') return false;
    return this.config.logInProduction;
  }

  private checkAndWarn(url: string, method: string): void {
    if (!this.shouldReport()) return;

    const snapshot = queryCounterStore.snapshot;
    if (!snapshot) return;

    if (snapshot.queryCount >= this.config.maxQueriesPerRequest) {
      const severity = this.nodeEnv === 'development' ? 'warn' : 'error';
      const message =
        `N+1 query pattern detected on ${method} ${url}: ` +
        `${snapshot.queryCount} queries (threshold: ${this.config.maxQueriesPerRequest}), ` +
        `total time: ${snapshot.totalTimeMs}ms`;

      if (severity === 'warn') {
        this.logger.warn(message);
      } else {
        this.logger.error(message, undefined, 'NPlus1Detection');
      }
    } else if (snapshot.totalTimeMs >= this.config.maxQueryTimeMs) {
      this.logger.warn(
        `Slow query aggregate on ${method} ${url}: ` +
        `${snapshot.queryCount} queries, ` +
        `total time: ${snapshot.totalTimeMs}ms (threshold: ${this.config.maxQueryTimeMs}ms)`,
      );
    }
  }
}