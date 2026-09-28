import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from '../logger';
import { SentryService } from '../sentry';

/**
 * Fallback exception filter for truly unhandled exceptions
 * This catches errors that bypass the GlobalExceptionFilter
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const error = exception instanceof Error ? exception : undefined;
    const correlationId =
      (request.headers['x-correlation-id'] as string) ||
      (request as Request & { correlationId?: string }).correlationId;
    const actorId =
      (request as Request & { user?: { id?: string } }).user?.id ??
      (request.headers['x-actor-id'] as string);

    this.logger.error(
      'Unhandled exception caught by fallback filter',
      error?.stack,
      {
        module: AllExceptionsFilter.name,
        action: 'unhandled_exception',
        correlationId,
        actorId,
        errorType: error?.name ?? typeof exception,
        errorMessage: error?.message ?? String(exception),
        path: request.url,
        method: request.method,
      },
    );

    this.sentry.captureException(
      error ?? new Error(`Unhandled exception: ${String(exception)}`),
      {
        correlationId,
        actorId,
        path: request.url,
        method: request.method,
        userAgent: request.get('user-agent'),
      },
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred',
      error: 'InternalServerError',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
