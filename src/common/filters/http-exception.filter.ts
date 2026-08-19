import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '../correlation/correlation-id.store';
import { ErrorCode } from '../error-classification/error-codes.enum';
import { ErrorResponseDto } from '../dto/error-response.dto';

/**
 * Standardised error payload returned by every API endpoint.
 * This filter ensures HttpException responses follow the same schema as other
 * global failures and include field-specific validation details when available.
 */
export interface ErrorPayload extends ErrorResponseDto {
  requestId?: string;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const statusCode = exception.getStatus();
    const body = exception.getResponse();
    const message = this.extractMessage(body, exception.message);
    const errorCode = this.extractErrorCode(body, statusCode);
    const details = this.extractDetails(body);
    const requestId = (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? undefined;

    const payload: ErrorPayload = {
      statusCode,
      errorCode,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
      ...(details ? { details } : {}),
    };

    this.logger.warn(
      `${req.method} ${req.url} → ${statusCode}${requestId ? ` [${requestId}]` : ''}`,
    );

    res.status(statusCode).json(payload);
  }

  private extractMessage(body: unknown, fallback: string): string | string[] {
    if (typeof body === 'string') return body;

    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      const msg = b['message'];
      if (typeof msg === 'string' || Array.isArray(msg)) return msg;
    }

    return fallback;
  }

  private extractDetails(body: unknown): Record<string, unknown> | undefined {
    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      const details = b['details'];
      if (details && typeof details === 'object') {
        return details as Record<string, unknown>;
      }
    }

    return undefined;
  }

  private extractErrorCode(body: unknown, statusCode: number): string {
    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      const code = b['code'];
      if (typeof code === 'string' && code.length > 0) return code;
    }

    const codeMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: ErrorCode.INVALID_INPUT,
      [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTH_FAILED,
      [HttpStatus.FORBIDDEN]: ErrorCode.ACCESS_DENIED,
      [HttpStatus.NOT_FOUND]: ErrorCode.RESOURCE_NOT_FOUND,
      [HttpStatus.CONFLICT]: ErrorCode.DUPLICATE_ENTRY,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMIT_EXCEEDED,
    };

    return codeMap[statusCode] ?? ErrorCode.UNKNOWN_ERROR;
  }
}
