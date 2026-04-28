import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TRACE_ID_HEADER } from '../../tracing/tracing.service';

/**
 * Standardised error payload returned by every API endpoint.
 * All fields are always present; `traceId` is included when request tracing
 * is active (see TracingMiddleware in src/tracing/tracing.service.ts).
 */
export interface ErrorPayload {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  traceId?: string;
}

/**
 * #366 — HTTP exception filter.
 *
 * Normalises every HttpException into the standard ErrorPayload shape so all
 * API endpoints return consistent error responses regardless of where the
 * exception originates.
 *
 * This filter handles HttpException only (@Catch(HttpException)).
 * Unknown / unhandled errors continue to be handled by GlobalExceptionFilter
 * (src/common/filters/global-exception.filter.ts) which also reports to Sentry.
 *
 * Registration order in main.ts:
 *   app.useGlobalFilters(
 *     new GlobalExceptionFilter(logger, sentryService),  // catches unknown errors
 *     new HttpExceptionFilter(),                          // normalises HTTP errors
 *   );
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const statusCode = exception.getStatus();
    const message = this.extractMessage(exception);
    const traceId = req.headers[TRACE_ID_HEADER] as string | undefined;

    const payload: ErrorPayload = {
      statusCode,
      error: HttpStatus[statusCode] ?? 'HttpException',
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
      ...(traceId && { traceId }),
    };

    this.logger.warn(
      `${req.method} ${req.url} → ${statusCode}${traceId ? ` [${traceId}]` : ''}`,
    );

    res.status(statusCode).json(payload);
  }

  private extractMessage(exception: HttpException): string | string[] {
    const body = exception.getResponse();

    if (typeof body === 'string') return body;

    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      const msg = b['message'];
      if (typeof msg === 'string' || Array.isArray(msg)) return msg;
    }

    return exception.message;
  }
}
