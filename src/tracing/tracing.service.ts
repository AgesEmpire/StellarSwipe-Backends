import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { CORRELATION_ID_HEADER } from '../common/correlation/correlation-id.store';

export const TRACE_ID_HEADER = 'x-trace-id';

/**
 * Helpers for reading and propagating trace IDs inside service/controller code.
 */
@Injectable()
export class TracingService {
  private readonly logger = new Logger(TracingService.name);
  private sampleRate: number;

  constructor(private readonly config: NestConfigService) {
    this.sampleRate = this.normalizeSampleRate(
      Number(this.config.get<string>('TRACING_SAMPLE_RATE') ?? process.env.TRACING_SAMPLE_RATE ?? 1),
    );
  }

  get isEnabled(): boolean {
    return this.config.get<string>('TRACING_ENABLED') === 'true' || process.env.TRACING_ENABLED === 'true';
  }

  get serviceName(): string {
    return this.config.get<string>('TRACING_SERVICE_NAME') ?? process.env.TRACING_SERVICE_NAME ?? 'stellarswipe-backend';
  }

  getSamplingRate(): number {
    return this.sampleRate;
  }

  setSamplingRate(sampleRate: number): { sampleRate: number } {
    this.sampleRate = this.normalizeSampleRate(sampleRate);
    process.env.TRACING_SAMPLE_RATE = String(this.sampleRate);
    process.env.OTEL_TRACES_SAMPLER_ARG = String(this.sampleRate);
    this.logger.log(`Tracing sample rate updated to ${this.sampleRate}`);
    return { sampleRate: this.sampleRate };
  }

  /** Extract the trace ID from an Express request. */
  fromRequest(req: Request): string | undefined {
    return req.headers[TRACE_ID_HEADER] as string | undefined;
  }

  getCorrelationAttributes(correlationId?: string): Record<string, string> {
    return correlationId ? { 'baggage.x_correlation_id': correlationId } : {};
  }

  /**
   * Headers to merge into outbound HTTP client calls so downstream services
   * receive the same trace and correlation IDs.
   */
  outboundHeaders(traceId: string, correlationId?: string): Record<string, string> {
    return {
      [TRACE_ID_HEADER]: traceId,
      ...(correlationId ? { [CORRELATION_ID_HEADER]: correlationId, baggage: `x-correlation-id=${correlationId}` } : {}),
      'x-service-name': this.serviceName,
    };
  }

  /** Structured log entry tied to a trace ID. */
  log(traceId: string, message: string, correlationId?: string): void {
    const suffix = correlationId ? ` correlation:${correlationId}` : '';
    this.logger.log(`[trace:${traceId}${suffix}] ${message}`);
  }

  private normalizeSampleRate(sampleRate: number): number {
    if (!Number.isFinite(sampleRate)) return 1;
    return Math.min(1, Math.max(0, sampleRate));
  }
}

/**
 * Request tracing middleware. Attaches trace and correlation metadata to every
 * inbound HTTP request and echoes the trace ID back to clients.
 */
@Injectable()
export class TracingMiddleware implements NestMiddleware {
  constructor(private readonly tracingService: TracingService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.tracingService.isEnabled) return next();

    const traceId =
      (req.headers[TRACE_ID_HEADER] as string | undefined) ?? randomUUID();
    const correlationId = req.headers[CORRELATION_ID_HEADER] as string | undefined;

    req.headers[TRACE_ID_HEADER] = traceId;
    if (correlationId) {
      req.headers.baggage = req.headers.baggage
        ? `${req.headers.baggage},x-correlation-id=${correlationId}`
        : `x-correlation-id=${correlationId}`;
    }
    res.setHeader(TRACE_ID_HEADER, traceId);

    this.tracingService.log(traceId, `${req.method} ${req.path}`, correlationId);
    next();
  }
}
