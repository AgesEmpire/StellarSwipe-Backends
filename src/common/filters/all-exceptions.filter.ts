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

    this.logger.error(
      'Unhandled exception caught by fallback filter',
      undefined,
      {
        exception: String(exception),
        path: request.url,
        method: request.method,
      },
    );

    this.sentry.captureException(
      exception instanceof Error
        ? exception
        : new Error(`Unhandled exception: ${String(exception)}`),
      {
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
