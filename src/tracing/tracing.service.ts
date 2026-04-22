import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ConfigService as NestConfigService } from '@nestjs/config';

export const TRACE_ID_HEADER = 'x-trace-id';

/**
 * #367 — Request tracing middleware.
 *
 * Attaches a trace ID to every inbound HTTP request:
 * - Reuses the client-supplied `x-trace-id` header when present (allows
 *   end-to-end correlation across services).
 * - Generates a new UUID v4 otherwise.
 * - Echoes the trace ID back in the response header.
 *
 * Works alongside the OpenTelemetry SDK initialised in
 * src/monitoring/tracing/jaeger.config.ts — the trace ID is propagated
 * through HTTP headers so Jaeger can correlate spans across service calls.
 */
@Injectable()
export class TracingMiddleware implements NestMiddleware {
  constructor(private readonly tracingService: TracingService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.tracingService.isEnabled) return next();

    const traceId =
      (req.headers[TRACE_ID_HEADER] as string | undefined) ?? randomUUID();

    req.headers[TRACE_ID_HEADER] = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);

    this.tracingService.log(traceId, `${req.method} ${req.path}`);
    next();
  }
}

/**
 * Helpers for reading and propagating trace IDs inside service/controller code.
 */
@Injectable()
export class TracingService {
  private readonly logger = new Logger(TracingService.name);

  constructor(private readonly config: NestConfigService) {}

  get isEnabled(): boolean {
    return process.env.TRACING_ENABLED === 'true';
  }

  get serviceName(): string {
    return process.env.TRACING_SERVICE_NAME ?? 'stellarswipe-backend';
  }

  /** Extract the trace ID from an Express request. */
  fromRequest(req: Request): string | undefined {
    return req.headers[TRACE_ID_HEADER] as string | undefined;
  }

  /**
   * Headers to merge into outbound HTTP client calls so downstream services
   * receive the same trace ID.
   */
  outboundHeaders(traceId: string): Record<string, string> {
    return {
      [TRACE_ID_HEADER]: traceId,
      'x-service-name': this.serviceName,
    };
  }

  /** Structured log entry tied to a trace ID. */
  log(traceId: string, message: string): void {
    this.logger.log(`[trace:${traceId}] ${message}`);
  }
}
