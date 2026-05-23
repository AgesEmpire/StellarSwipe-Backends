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

const SERVICE_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/^\/api\/v\d+\/auth/, 'auth'],
  [/^\/api\/v\d+\/trades/, 'trades'],
  [/^\/api\/v\d+\/signals/, 'signals'],
  [/^\/api\/v\d+\/portfolio/, 'portfolio'],
  [/^\/api\/v\d+\/users/, 'users'],
  [/^\/api\/v\d+\/analytics/, 'analytics'],
  [/^\/api\/v\d+\/webhooks/, 'webhooks'],
  [/^\/health/, 'health'],
  [/^\/metrics/, 'metrics'],
];

function resolveServiceType(path: string): string {
  for (const [pattern, type] of SERVICE_TYPE_PATTERNS) {
    if (pattern.test(path)) return type;
  }
  return 'api';
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly prometheus: PrometheusService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();

    const route = (req.route?.path as string) ?? req.path;
    const serviceType = resolveServiceType(req.path);

    const finish = (statusCode: number) => {
      const durationNs = process.hrtime.bigint() - start;
      const durationSeconds = Number(durationNs) / 1e9;
      this.prometheus.observeHttpRequest(req.method, route, statusCode, durationSeconds, serviceType);
    };

    return next.handle().pipe(
      tap(() => finish(res.statusCode)),
      catchError((err) => {
        finish(err?.status ?? 500);
        throw err;
      }),
    );
  }
}
