import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import * as crypto from 'crypto';
import { ApiSnapshot } from '../entities/performance-snapshot.entity';

export interface ApiSample {
  timestamp: Date;
  snapshot: ApiSnapshot;
}

export interface ApiProfilerConfig {
  slowApiThresholdMs: number;
  captureRequestBody: boolean;
}

@Injectable()
export class ApiProfiler implements NestInterceptor {
  private readonly logger = new Logger(ApiProfiler.name);
  private samples: ApiSample[] = [];
  private active = false;
  private config: ApiProfilerConfig = {
    slowApiThresholdMs: 500,
    captureRequestBody: false,
  };

  configure(config: Partial<ApiProfilerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  startRecording(): void {
    this.active = true;
    this.samples = [];
    this.logger.debug('API profiler recording started');
  }

  stopRecording(): ApiSample[] {
    this.active = false;
    this.logger.debug(`API profiler stopped. Captured ${this.samples.length} requests`);
    return [...this.samples];
  }

  /**
   * NestJS interceptor — passively records every inbound HTTP request.
   */
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.active) return next.handle();

    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const start = performance.now();
    const traceId = (req.headers['x-trace-id'] as string) ?? crypto.randomUUID();

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res, start, traceId),
        error: () => this.record(req, res, start, traceId),
      }),
    );
  }

  private record(req: any, res: any, start: number, traceId: string): void {
    try {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      const route =
        req.route?.path ?? req.url ?? 'unknown';

      const snapshot: ApiSnapshot = {
        method: req.method,
        route,
        statusCode: res.statusCode ?? 200,
        durationMs,
        requestSizeBytes: parseInt(req.headers['content-length'] ?? '0', 10) || 0,
        responseSizeBytes: parseInt(res.getHeader?.('content-length') ?? '0', 10) || 0,
        userId: req.user?.id,
        traceId,
      };

      this.samples.push({ timestamp: new Date(), snapshot });
    } catch (err) {
      this.logger.warn(`API snapshot record failed: ${err.message}`);
    }
  }

  aggregateEndpoints(samples: ApiSample[]): Array<{
    method: string;
    route: string;
    avgDurationMs: number;
    p99DurationMs: number;
    requestCount: number;
    errorRate: number;
  }> {
    const map = new Map<
      string,
      { durations: number[]; errors: number }
    >();

    for (const s of samples) {
      const key = `${s.snapshot.method}:${s.snapshot.route}`;
      if (!map.has(key)) map.set(key, { durations: [], errors: 0 });
      const entry = map.get(key)!;
      entry.durations.push(s.snapshot.durationMs);
      if (s.snapshot.statusCode >= 500) entry.errors++;
    }

    return Array.from(map.entries())
      .map(([key, data]) => {
        const [method, route] = key.split(':');
        const sorted = [...data.durations].sort((a, b) => a - b);
        return {
          method,
          route,
          avgDurationMs:
            Math.round(
              (sorted.reduce((a, b) => a + b, 0) / sorted.length) * 100,
            ) / 100,
          p99DurationMs:
            sorted[Math.floor(sorted.length * 0.99)] ??
            sorted[sorted.length - 1],
          requestCount: sorted.length,
          errorRate:
            Math.round((data.errors / sorted.length) * 10000) / 100,
        };
      })
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs);
  }

  computeStats(samples: ApiSample[]): {
    total: number;
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
    errorRate: number;
    slowCount: number;
    throughputPerMin: number;
  } {
    if (!samples.length)
      return {
        total: 0,
        avgMs: 0,
        p95Ms: 0,
        p99Ms: 0,
        errorRate: 0,
        slowCount: 0,
        throughputPerMin: 0,
      };

    const durations = samples
      .map((s) => s.snapshot.durationMs)
      .sort((a, b) => a - b);

    const errors = samples.filter((s) => s.snapshot.statusCode >= 500).length;
    const slowCount = samples.filter(
      (s) => s.snapshot.durationMs >= this.config.slowApiThresholdMs,
    ).length;

    const durationMs =
      samples[samples.length - 1].timestamp.getTime() -
      samples[0].timestamp.getTime();
    const throughputPerMin =
      durationMs > 0 ? Math.round((samples.length / durationMs) * 60000) : 0;

    return {
      total: samples.length,
      avgMs:
        Math.round(
          (durations.reduce((a, b) => a + b, 0) / durations.length) * 100,
        ) / 100,
      p95Ms: durations[Math.floor(durations.length * 0.95)] ?? durations[durations.length - 1],
      p99Ms: durations[Math.floor(durations.length * 0.99)] ?? durations[durations.length - 1],
      errorRate: Math.round((errors / samples.length) * 10000) / 100,
      slowCount,
      throughputPerMin,
    };
  }

  getStatusCodeDistribution(samples: ApiSample[]): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const s of samples) {
      const bucket = `${Math.floor(s.snapshot.statusCode / 100)}xx`;
      dist[bucket] = (dist[bucket] ?? 0) + 1;
    }
    return dist;
  }
}
