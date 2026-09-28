import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { Histogram } from 'prom-client';
import { PrometheusService } from '../metrics/prometheus.service';

/**
 * PayloadSizeInterceptor (#702)
 *
 * Records request and response body sizes (bytes) per route+method
 * as Prometheus histograms, without buffering the full body in memory.
 *
 * - Request size: read from Content-Length header (O(1), no body buffering).
 * - Response size: patch res.write / res.end to count chunks as they stream out.
 *
 * Metrics exposed on the existing /api/v1/metrics endpoint.
 */
@Injectable()
export class PayloadSizeInterceptor implements NestInterceptor {
  private readonly requestBodySize: Histogram;
  private readonly responseBodySize: Histogram;

  constructor(private readonly prometheus: PrometheusService) {
    const buckets = [0, 256, 1024, 4096, 16384, 65536, 262144, 1048576];

    this.requestBodySize = new Histogram({
      name: 'http_request_body_bytes',
      help: 'HTTP request body size in bytes',
      labelNames: ['method', 'route'],
      buckets,
      registers: [this.prometheus.registry],
    });

    this.responseBodySize = new Histogram({
      name: 'http_response_body_bytes',
      help: 'HTTP response body size in bytes',
      labelNames: ['method', 'route'],
      buckets,
      registers: [this.prometheus.registry],
    });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const method = req.method;
    // Resolved after routing; falls back to raw path before route match
    const getRoute = (): string =>
      (req.route?.path as string | undefined) ?? req.path;

    // ── Request size: use Content-Length header (no buffering) ──
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    const reqBytes = Number.isFinite(contentLength) ? contentLength : 0;

    // ── Response size: instrument res.write / res.end ──────────
    let totalResponseBytes = 0;

    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    // Overload signatures match Node's ServerResponse
    (res as any).write = (
      chunk: any,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      if (chunk) {
        totalResponseBytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(chunk, typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8');
      }
      return typeof encodingOrCb === 'function'
        ? origWrite(chunk, encodingOrCb)
        : origWrite(chunk, encodingOrCb as BufferEncoding, cb as any);
    };

    (res as any).end = (
      chunk?: any,
      encodingOrCb?: BufferEncoding | (() => void),
      cb?: () => void,
    ): Response => {
      if (chunk) {
        totalResponseBytes += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(chunk, typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8');
      }
      return typeof encodingOrCb === 'function'
        ? origEnd(chunk, encodingOrCb)
        : origEnd(chunk, encodingOrCb as BufferEncoding, cb as any);
    };

    return next.handle().pipe(
      tap({
        next: () => this.record(method, getRoute(), reqBytes, totalResponseBytes),
        error: () => this.record(method, getRoute(), reqBytes, totalResponseBytes),
      }),
    );
  }

  private record(
    method: string,
    route: string,
    reqBytes: number,
    resBytes: number,
  ): void {
    const labels = { method, route };
    this.requestBodySize.observe(labels, reqBytes);
    this.responseBodySize.observe(labels, resBytes);
  }
}
