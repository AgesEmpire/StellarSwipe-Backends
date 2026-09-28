import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { PrometheusService } from '../metrics/prometheus.service';

/**
 * Route path segments excluded from RED (Rate/Error/Duration) HTTP metrics.
 * The health and metrics endpoints are polled/scraped far more frequently
 * than business routes; instrumenting them would feed their own request
 * volume back into the RED dashboards as recursive noise (Issue #1076).
 */
const EXCLUDED_ROUTE_SEGMENTS = ['/health', '/metrics'];

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly prometheus: PrometheusService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // Normalized route template (e.g. "/users/:id"), never the raw URL with
    // its resolved params/query string — keeps label cardinality low and
    // keeps path-embedded IDs/PII out of metric labels.
    const route = (req.route?.path as string) ?? req.path;

    if (this.isExcludedRoute(route)) {
      return next.handle();
    }

    const start = process.hrtime.bigint();

    const finish = (statusCode: number) => {
      const durationNs = process.hrtime.bigint() - start;
      const durationSeconds = Number(durationNs) / 1e9;
      this.prometheus.observeHttpRequest(req.method, route, statusCode, durationSeconds);
    };

    return next.handle().pipe(
      tap(() => finish(res.statusCode)),
      catchError((err) => {
        finish(err?.status ?? 500);
        throw err;
      }),
    );
  }

  private isExcludedRoute(route: string): boolean {
    return EXCLUDED_ROUTE_SEGMENTS.some((segment) => route.includes(segment));
  }
}
