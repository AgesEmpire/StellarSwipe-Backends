import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { SentryService } from '../sentry';
import { CORRELATION_ID_HEADER } from '../correlation/correlation-id.store';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { StellarException, SorobanException } from '../exceptions';
import { getCorrelationId } from '../correlation';

/**
 * Stable error response shape returned for every failure:
 * { statusCode, error, message, correlationId, timestamp, path }
 */
export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  correlationId?: string;
  timestamp: string;
  path: string;
}

const SECRET_PATTERN =
  /((?:password|secret|token|api[_-]?key|authorization|private[_-]?key)\s*[=:]\s*)[^\s,;&"']+/gi;

export const redact = (value: string): string =>
  value.replace(SECRET_PATTERN, '$1[REDACTED]');
import { ErrorClassificationService } from '../error-classification/error-classification.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
    private readonly errorClassifier: ErrorClassificationService,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = (request as any).correlationId ?? getCorrelationId();
    const meta = { path: request.url, method: request.method, correlationId };

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'InternalServerError';
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      message = typeof body === 'string' ? body : body?.message ?? exception.message;
      error = typeof body === 'object' && body?.error ? body.error : exception.name;

      if (exception instanceof StellarException) {
        error = 'StellarError';
        this.logger.error('Stellar blockchain error', exception, {
          ...meta,
          stellarError: exception.stellarError,
        });
      } else if (exception instanceof SorobanException) {
        error = 'SorobanError';
        this.logger.error('Soroban contract error', exception, {
          ...meta,
          contractId: exception.contractId,
          sorobanError: exception.sorobanError,
        });
      } else if (status >= 500) {
        this.logger.error(`HTTP ${status} error`, exception, meta);
      } else {
        this.logger.warn(`HTTP ${status} error`, { ...meta, statusCode: status });
      }
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      error = 'NotFound';
      message = 'Resource not found';
      this.logger.warn('Entity not found', meta);
    } else if (exception instanceof QueryFailedError) {
      const code = (exception as any).driverError?.code;
      if (code === '23505') {
        status = HttpStatus.CONFLICT;
        error = 'Conflict';
        message = 'Resource already exists';
      } else {
        error = 'DatabaseError';
      }
      this.logger.error('Database query failed', exception, { ...meta, code });
      if (status >= 500) this.sentry.captureException(exception, meta);
    } else {
      // Unexpected errors: never expose internal message or stack to clients.
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error('Unhandled error', err, meta);
      this.sentry.captureException(err, { ...meta, userAgent: request.get?.('user-agent') });
    }

    // 5xx responses always use a generic message to avoid leaking internals.
    if (status >= 500 && error !== 'StellarError' && error !== 'SorobanError') {
      message = 'Internal server error';
    }

    const body: ErrorResponse = {
      statusCode: status,
      error,
      message: Array.isArray(message) ? message.map(redact) : redact(String(message)),
      correlationId,
      timestamp: new Date().toISOString(),
    const classification = this.errorClassifier.classify(exception);

    this.errorClassifier.logError({
      classification: classification.classification,
      code: classification.code,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      originalError: classification.originalError,
    });

    // Build error response
    const errorResponse: ErrorResponseDto = {
      statusCode: classification.httpStatus,
      errorCode: classification.code,
      message: classification.message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: (request.headers[CORRELATION_ID_HEADER] as string) || undefined,
    };

    response.status(status).json(body);
    // Include details in development mode
    if (
      this.configService.get<string>('NODE_ENV') === 'development' &&
      classification.originalError
    ) {
      errorResponse.details = {
        name: classification.originalError.name,
        retryable: classification.isRetryable,
      };
    }

    response.status(classification.httpStatus).json(errorResponse);
  }
}
