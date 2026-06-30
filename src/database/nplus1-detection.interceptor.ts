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
import { queryCounterStore } from './query-counter.store';

export interface NPlus1DetectionConfig {
  maxQueriesPerRequest: number;
  maxQueryTimeMs: number;
}

@Injectable()
export class NPlus1DetectionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(NPlus1DetectionInterceptor.name);
  private readonly config: NPlus1DetectionConfig;

  constructor(
    configService: ConfigService,
    correlationIdStore: CorrelationIdStore,
  ) {
    this.config = {
      maxQueriesPerRequest: configService.get<number>('NPLUS1_MAX_QUERIES', 25),
      maxQueryTimeMs: configService.get<number>('NPLUS1_MAX_QUERY_TIME_MS', 1000),
    };
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const nodeEnv = process.env.NODE_ENV;

    if (nodeEnv !== 'development') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const url = request.url;
    const method = request.method;

    return queryCounterStore.run(
      { method, url },
      () => next.handle().pipe(
        tap({ 
          complete: () => this.checkAndWarn(url, method),
          error: () => this.checkAndWarn(url, method),
        }),
      ),
    );
  }

  private checkAndWarn(url: string, method: string): void {
    const snapshot = queryCounterStore.snapshot;
    if (!snapshot) return;

    if (snapshot.queryCount >= this.config.maxQueriesPerRequest) {
      this.logger.warn(
        `Possible N+1 query pattern detected on ${method} ${url}: ` +
        `${snapshot.queryCount} queries (threshold: ${this.config.maxQueriesPerRequest}), ` +
        `total time: ${snapshot.totalTimeMs}ms (threshold: ${this.config.maxQueryTimeMs}ms)`,
      );
    } else if (snapshot.totalTimeMs >= this.config.maxQueryTimeMs) {
      this.logger.warn(
        `Slow query aggregate on ${method} ${url}: ` +
        `${snapshot.queryCount} queries, ` +
        `total time: ${snapshot.totalTimeMs}ms (threshold: ${this.config.maxQueryTimeMs}ms)`,
      );
    }
  }
}