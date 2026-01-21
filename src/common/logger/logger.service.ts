import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/**
 * Winston-based logger service with structured logging
 * Handles PII sanitization and circular JSON references
 */
@Injectable()
export class LoggerService implements NestLoggerService {
  private logger!: winston.Logger;
  private context?: string;

  // Sensitive fields to sanitize from logs
  private readonly sensitiveFields = [
    'password',
    'token',
    'apiKey',
    'secretKey',
    'privateKey',
    'authorization',
    'secret',
    'accessToken',
    'refreshToken',
  ];

  constructor(private readonly configService: ConfigService) {
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
   * Sanitize sensitive data from objects
   */
  private sanitize(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    // Handle circular references
    const seen = new WeakSet();
    const sanitizeRecursive = (item: any): any => {
      if (item === null || typeof item !== 'object') {
        return item;
      }

      if (seen.has(item)) {
        return '[Circular]';
      }

      seen.add(item);

      if (Array.isArray(item)) {
        return item.map((element) => sanitizeRecursive(element));
      }

      const sanitized: any = {};
      for (const key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
          if (
            this.sensitiveFields.some((field) =>
              key.toLowerCase().includes(field.toLowerCase()),
            )
          ) {
            sanitized[key] = '[REDACTED]';
          } else {
            sanitized[key] = sanitizeRecursive(item[key]);
          }
        }
      }

      return sanitized;
    };

    return sanitizeRecursive(obj);
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
      context: this.context,
      ...sanitizedContext,
    });
  }

  /**
   * Log warning level message
   */
  warn(message: string, context?: Record<string, any>): void {
    const sanitizedContext = this.sanitize(context);
    this.logger.warn(message, {
      context: this.context,
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
        context: this.context,
        error: {
          name: errorOrTrace.name,
          message: errorOrTrace.message,
          stack: errorOrTrace.stack,
        },
        ...sanitizedContext,
      });
    } else {
      this.logger.error(message, {
        context: this.context,
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
      context: this.context,
      ...sanitizedContext,
    });
  }

  /**
   * Log verbose level message
   */
  verbose(message: string, context?: Record<string, any>): void {
    const sanitizedContext = this.sanitize(context);
    this.logger.verbose(message, {
      context: this.context,
      ...sanitizedContext,
    });
  }
}
