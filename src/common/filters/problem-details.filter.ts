import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { I18nValidationException } from 'nestjs-i18n';
import { ValidationError } from 'class-validator';
import { LoggerService } from '../logger';
import { SentryService } from '../sentry';
import { CORRELATION_ID_HEADER } from '../correlation/correlation-id.store';
import { ErrorClassificationService } from '../error-classification/error-classification.service';
import { ErrorCode } from '../error-classification/error-codes.enum';
import { FieldValidationError, ProblemDetailsDto } from '../dto/problem-details.dto';

const TITLES_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Validation Failed',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.PAYMENT_REQUIRED]: 'Payment Required',
  [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

const STABLE_INTERNAL_ERROR_MESSAGE =
  'An unexpected error occurred. Please retry, and contact support with the correlation ID if the problem persists.';

/**
 * Single global exception filter mapping every thrown error — validation
 * failures, domain exceptions, authentication/authorization rejections, and
 * unexpected system errors — onto a consistent RFC 7807 Problem Details
 * response (application/problem+json). Replaces the previously separate
 * GlobalExceptionFilter / HttpExceptionFilter / I18nValidationExceptionFilter
 * chain so every documented error shares one schema.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
    private readonly errorClassifier: ErrorClassificationService,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const correlationId =
      (request.headers?.[CORRELATION_ID_HEADER] as string | undefined) ?? undefined;

    const problem = this.buildProblem(exception, request, correlationId);

    this.logAndReport(exception, request, problem);

    response
      .status(problem.status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(problem);
  }

  private buildProblem(
    exception: unknown,
    request: Request,
    correlationId: string | undefined,
  ): ProblemDetailsDto {
    if (exception instanceof I18nValidationException) {
      return this.fromValidationException(exception, request, correlationId);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception, request, correlationId);
    }

    return this.fromUnexpectedError(exception, request, correlationId);
  }

  private fromValidationException(
    exception: I18nValidationException,
    request: Request,
    correlationId: string | undefined,
  ): ProblemDetailsDto {
    const status = exception.getStatus?.() ?? HttpStatus.UNPROCESSABLE_ENTITY;
    const errors = this.flattenValidationErrors(exception.errors ?? []);
    const detail =
      errors.length > 0
        ? `Validation failed for ${errors.length} field(s). See "errors" for details.`
        : 'Request validation failed.';

    return {
      type: `urn:stellarswipe:problem:${ErrorCode.INVALID_INPUT}`,
      title: TITLES_BY_STATUS[status] ?? 'Validation Failed',
      status,
      detail,
      instance: request.url,
      timestamp: new Date().toISOString(),
      correlationId,
      errorCode: ErrorCode.INVALID_INPUT,
      errors,
    };
  }

  private fromHttpException(
    exception: HttpException,
    request: Request,
    correlationId: string | undefined,
  ): ProblemDetailsDto {
    const status = exception.getStatus();
    const classification = this.errorClassifier.classify(exception);
    const body = exception.getResponse();
    const detail = this.extractDetail(body, classification.message);
    const errors = this.extractFieldErrors(body);

    return {
      type: `urn:stellarswipe:problem:${classification.code}`,
      title: TITLES_BY_STATUS[status] ?? classification.classification,
      status,
      detail,
      instance: request.url,
      timestamp: new Date().toISOString(),
      correlationId,
      errorCode: classification.code,
      ...(errors ? { errors } : {}),
    };
  }

  private fromUnexpectedError(
    exception: unknown,
    request: Request,
    correlationId: string | undefined,
  ): ProblemDetailsDto {
    const classification = this.errorClassifier.classify(exception);
    const status =
      classification.httpStatus >= 400 ? classification.httpStatus : HttpStatus.INTERNAL_SERVER_ERROR;

    // Non-retryable, 5xx classifications hide the underlying message from
    // clients — only the correlation ID is exposed so support can look up
    // the real cause from server-side logs / Sentry.
    const detail =
      status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? STABLE_INTERNAL_ERROR_MESSAGE
        : classification.message;

    return {
      type: `urn:stellarswipe:problem:${classification.code}`,
      title: TITLES_BY_STATUS[status] ?? 'Internal Server Error',
      status,
      detail,
      instance: request.url,
      timestamp: new Date().toISOString(),
      correlationId,
      errorCode: classification.code,
    };
  }

  private flattenValidationErrors(
    errors: ValidationError[],
    parentPath = '',
  ): FieldValidationError[] {
    const result: FieldValidationError[] = [];

    for (const error of errors) {
      const field = parentPath ? `${parentPath}.${error.property}` : error.property;

      if (error.constraints) {
        result.push({ field, messages: Object.values(error.constraints) });
      }

      if (error.children && error.children.length > 0) {
        result.push(...this.flattenValidationErrors(error.children, field));
      }
    }

    return result;
  }

  private extractDetail(body: unknown, fallback: string): string {
    if (typeof body === 'string') return body;

    if (typeof body === 'object' && body !== null) {
      const message = (body as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }

    return fallback;
  }

  private extractFieldErrors(body: unknown): FieldValidationError[] | undefined {
    if (typeof body !== 'object' || body === null) return undefined;

    const message = (body as Record<string, unknown>).message;
    if (!Array.isArray(message) || message.length === 0) return undefined;

    // Standard Nest ValidationPipe shape: message is a flat string[] of
    // "field constraint" sentences, not structured per field — surface them
    // as a single synthetic "request" field entry so clients still get an
    // `errors` array without misrepresenting the source field.
    return [{ field: 'request', messages: message.map(String) }];
  }

  private logAndReport(exception: unknown, request: Request, problem: ProblemDetailsDto): void {
    const context = {
      path: request.url,
      method: request.method,
      status: problem.status,
      errorCode: problem.errorCode,
      correlationId: problem.correlationId,
    };

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('Unhandled exception', undefined, {
        ...context,
        exception: exception instanceof Error ? exception.stack : String(exception),
      });
      this.sentry.captureException(
        exception instanceof Error ? exception : new Error(`Unhandled exception: ${String(exception)}`),
        context,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${problem.status}`, context);
    }

    if (this.configService.get<string>('NODE_ENV') === 'development' && exception instanceof Error) {
      (problem as any).debug = { name: exception.name, stack: exception.stack };
    }
  }
}
