import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { LoggerService } from '../logger';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(LoggingInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    const { method, url, body, query, params } = request;
    const requestId = uuidv4();

    // Add request ID to request object for tracing
    (request as any).requestId = requestId;

    // Log incoming request (only in development for body)
    const requestLog: any = {
      requestId,
      method,
      url,
      query,
      params,
      userAgent: request.get('user-agent'),
      ip: request.ip,
    };

    // Only log request body in development
    if (
      process.env.NODE_ENV === 'development' &&
      body &&
      Object.keys(body).length > 0
    ) {
      requestLog.body = body;
    }

    this.logger.info('Incoming request', requestLog);

    return next.handle().pipe(
      tap((data: unknown) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        const responseLog: Record<string, unknown> = {
          requestId,
          method,
          url,
          statusCode,
          duration: `${duration}ms`,
        };

        // Only log response body in development
        if (process.env.NODE_ENV === 'development' && data) {
          responseLog.responseData = data;
        }

        this.logger.info('Request completed', responseLog);
      }),
      catchError((error: Error) => {
        const duration = Date.now() - startTime;

        this.logger.error('Request failed', error, {
          requestId,
          method,
          url,
          duration: `${duration}ms`,
        });

        throw error;
      }),
    );
  }
}
