import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { CorrelationIdStore } from '../correlation/correlation-id.store';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly correlationIdStore: CorrelationIdStore,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(LoggingInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    const { method, url, body, query, params } = request;
    // Assigned upstream by CorrelationIdMiddleware; read from the request as a fallback.
    const correlationId =
      this.correlationIdStore.getCorrelationId() ??
      (request as any).correlationId;
    const userId = (request as any).user?.id ?? (request as any).user?.sub;

    // Log incoming request (only in development for body)
    const requestLog: any = {
      correlationId,
      method,
      url,
      query,
      params,
      userAgent: request.get('user-agent'),
      ip: request.ip,
      ...(userId ? { userId } : {}),
    };

    // Only log request body in development
    if (
      this.configService.get<string>('NODE_ENV') === 'development' &&
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
          correlationId,
          method,
          url,
          statusCode,
          duration: `${duration}ms`,
          ...(userId ? { userId } : {}),
        };

        // Only log response body in development
        if (this.configService.get<string>('NODE_ENV') === 'development' && data) {
          responseLog.responseData = data;
        }

        this.logger.info('Request completed', responseLog);
      }),
      catchError((error: Error) => {
        const duration = Date.now() - startTime;

        this.logger.error('Request failed', error, {
          correlationId,
          method,
          url,
          duration: `${duration}ms`,
          ...(userId ? { userId } : {}),
        });

        throw error;
      }),
    );
  }
}
