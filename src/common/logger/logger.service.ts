import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { CorrelationIdStore } from '../correlation/correlation-id.store';
import { redactSensitiveFields } from './log-redaction';

/**
 * Winston-based logger service with structured logging
 * Handles PII sanitization and circular JSON references
 */
@Injectable()
export class LoggerService implements NestLoggerService {
  private logger!: winston.Logger;
  private context?: string;

  // Field-level redaction is now handled by the standalone redactSensitiveFields
  // utility (log-redaction.ts), which supports configurable field lists via env.

  constructor(
    private readonly configService: ConfigService,
    private readonly correlationIdStore: CorrelationIdStore,
  ) {
    this.initializeLogger();
  }

  private initializeLogger(): void {
    const nodeEnv = this.configService.get('app.nodeEnv');
    const logLevel = this.configService.get('app.logger.level', 'info');
    const logDirectory =
      this.configService.get('app.logger.directory') || './logs';
    const maxFiles = this.configService.get('app.logger.maxFiles', '14d');
    const maxSize = this.configService.get('app.logger.maxSize', '20m');

    const transports: winston.transport[] = [];

    // Console transport
    if (nodeEnv === 'development') {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf((info) => {
              const ctx = info.context ? `[${info.context}]` : '';
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { timestamp, level, message, context, ...meta } = info;
              const metaStr = Object.keys(meta).length
                ? `\n${JSON.stringify(meta, null, 2)}`
                : '';
              return `${timestamp} ${level} ${ctx} ${message}${metaStr}`;
            }),
          ),
        }),
      );
    } else {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
      );
    }

    // File transports for production
    if (nodeEnv === 'production') {
      // Error logs
      transports.push(
        new DailyRotateFile({
          filename: `${logDirectory}/error-%DATE%.log`,
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxFiles,
          maxSize,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
      );

      // Combined logs
      transports.push(
        new DailyRotateFile({
          filename: `${logDirectory}/combined-%DATE%.log`,
          datePattern: 'YYYY-MM-DD',
          maxFiles,
          maxSize,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      transports,
      exitOnError: false,
    });
  }

  /**
   * Set context for subsequent log messages
   */
  setContext(context: string): void {
    this.context = context;
  }

  /**
   * Base fields attached to every log line: logger context plus the
   * request-scoped correlation ID, when one is available.
   */
  private baseMeta(): Record<string, any> {
    const correlationId = this.correlationIdStore.getCorrelationId();
    return {
      context: this.context,
      ...(correlationId ? { correlationId } : {}),
    };
  }

  /**
   * Redact sensitive / PII fields from a log metadata object before writing.
   * Delegates to the configurable redactSensitiveFields utility so that field
   * lists can be extended without touching this file.
   */
  private sanitize(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    return redactSensitiveFields(obj);
  }

  /**
   * Log info level message
   */
  log(message: string, context?: Record<string, any>): void {
    this.info(message, context);
  }

  /**
   * Log info level message
   */
  info(message: string, context?: Record<string, any>): void {
    const sanitizedContext = this.sanitize(context);
    this.logger.info(message, {
      ...this.baseMeta(),
      ...sanitizedContext,
    });
  }

  /**
   * Log warning level message
   */
  warn(message: string, context?: Record<string, any>): void {
    const sanitizedContext = this.sanitize(context);
    this.logger.warn(message, {
      ...this.baseMeta(),
      ...sanitizedContext,
    });
  }

  /**
   * Log error level message
   */
  error(message: string, trace?: string, context?: Record<string, any>): void;
  error(message: string, error?: Error, context?: Record<string, any>): void;
  error(
    message: string,
    errorOrTrace?: string | Error,
    context?: Record<string, any>,
  ): void {
    const sanitizedContext = this.sanitize(context);

    if (errorOrTrace instanceof Error) {
      this.logger.error(message, {
        ...this.baseMeta(),
        error: {
          name: errorOrTrace.name,
          message: errorOrTrace.message,
          stack: errorOrTrace.stack,
        },
        ...sanitizedContext,
      });
    } else {
      this.logger.error(message, {
        ...this.baseMeta(),
        trace: errorOrTrace,
        ...sanitizedContext,
      });
    }
  }

  /**
   * Log debug level message
   */
  debug(message: string, context?: Record<string, any>): void {
    const sanitizedContext = this.sanitize(context);
    this.logger.debug(message, {
      ...this.baseMeta(),
      ...sanitizedContext,
    });
  }

  /**
   * Log verbose level message
   */
  verbose(message: string, context?: Record<string, any>): void {
    const sanitizedContext = this.sanitize(context);
    this.logger.verbose(message, {
      ...this.baseMeta(),
      ...sanitizedContext,
    });
  }
}
