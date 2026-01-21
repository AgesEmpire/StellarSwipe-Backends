import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from '../logger';
import { SentryService } from '../sentry';
import { StellarException, SorobanException } from '../exceptions';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
  ) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'InternalServerError';
    let details: any = {};

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || exception.message;
        error = responseObj.error || exception.name;
        details = responseObj;
      } else {
        message = exceptionResponse;
        error = exception.name;
      }

      // Special handling for Stellar exceptions
      if (exception instanceof StellarException) {
        error = 'StellarError';
        this.logger.error('Stellar blockchain error', exception, {
          stellarError: (exception as StellarException).stellarError,
          path: request.url,
          method: request.method,
        });
      }
      // Special handling for Soroban exceptions
      else if (exception instanceof SorobanException) {
        error = 'SorobanError';
        const sorobanEx = exception as SorobanException;
        this.logger.error('Soroban contract error', exception, {
          contractId: sorobanEx.contractId,
          method: sorobanEx.method,
          sorobanError: sorobanEx.sorobanError,
          path: request.url,
          httpMethod: request.method,
        });
      }
      // Other HTTP exceptions
      else {
        this.logger.warn(`HTTP ${status} error`, {
          message,
          path: request.url,
          method: request.method,
          statusCode: status,
        });
      }
    }
    // Handle standard errors
    else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
      details = { name: exception.name, stack: exception.stack };

      this.logger.error('Unhandled error', exception, {
        path: request.url,
        method: request.method,
      });

      // Report to Sentry for non-HTTP exceptions
      this.sentry.captureException(exception, {
        path: request.url,
        method: request.method,
        userAgent: request.get('user-agent'),
      });
    }
    // Handle unknown exceptions
    else {
      this.logger.error('Unknown exception type', undefined, {
        exception: String(exception),
        path: request.url,
        method: request.method,
      });

      this.sentry.captureException(
        new Error(`Unknown exception: ${String(exception)}`),
        {
          path: request.url,
          method: request.method,
        },
      );
    }

    // Build error response
    const errorResponse: any = {
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Include details in development mode
    if (
      process.env.NODE_ENV === 'development' &&
      Object.keys(details).length > 0
    ) {
      errorResponse.details = details;
    }

    response.status(status).json(errorResponse);
  }
}
