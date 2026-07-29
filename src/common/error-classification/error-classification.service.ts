import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorClassification } from './error-classification.enum';
import { ErrorCode } from './error-codes.enum';
import { LoggerService } from '../logger';

export interface ClassificationError {
  classification: ErrorClassification;
  code: ErrorCode;
  message: string;
  httpStatus: HttpStatus;
  isRetryable: boolean;
  originalError?: any;
}

export interface ErrorMetadata {
  classification: ErrorClassification;
  code: ErrorCode;
  timestamp: string;
  path?: string;
  method?: string;
  userId?: string;
  correlationId?: string;
  originalError?: any;
  context?: Record<string, any>;
}

@Injectable()
export class ErrorClassificationService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(ErrorClassificationService.name);
  }

  classify(error: unknown, context?: Record<string, any>): ClassificationError {
    const timestamp = new Date().toISOString();

    if (error instanceof HttpException) {
      return this.classifyHttpException(error, context);
    }

    if (error instanceof Error) {
      return this.classifyError(error, context);
    }

    return {
      classification: ErrorClassification.SYSTEM,
      code: ErrorCode.UNKNOWN_ERROR,
      message: 'An unexpected error occurred',
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      isRetryable: false,
      originalError: error,
    };
  }

  private classifyError(error: Error, context?: Record<string, any>): ClassificationError {
    const message = error.message.toLowerCase();
    const stack = error.stack || '';

    if (this.isSorobanError(error, message)) {
      return {
        classification: ErrorClassification.EXTERNAL_SERVICE,
        code: ErrorCode.SOROBAN_CONTRACT_ERROR,
        message: this.mapSorobanError(error),
        httpStatus: HttpStatus.BAD_GATEWAY,
        isRetryable: this.isRetryableSorobanError(message),
        originalError: error,
      };
    }

    if (this.isSdexError(message)) {
      return {
        classification: ErrorClassification.EXTERNAL_SERVICE,
        code: ErrorCode.SDEX_PRICE_ERROR,
        message: this.mapSdexError(error),
        httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
        isRetryable: true,
        originalError: error,
      };
    }

    if (this.isStellarHorizonError(message, stack)) {
      return {
        classification: ErrorClassification.EXTERNAL_SERVICE,
        code: ErrorCode.STELLAR_HORIZON_ERROR,
        message: 'Stellar network temporarily unavailable',
        httpStatus: HttpStatus.BAD_GATEWAY,
        isRetryable: true,
        originalError: error,
      };
    }

    if (this.isValidationError(message)) {
      return {
        classification: ErrorClassification.VALIDATION,
        code: ErrorCode.INVALID_INPUT,
        message: error.message,
        httpStatus: HttpStatus.BAD_REQUEST,
        isRetryable: false,
        originalError: error,
      };
    }

    if (this.isDatabaseError(message, stack)) {
      return {
        classification: ErrorClassification.SYSTEM,
        code: ErrorCode.DATABASE_ERROR,
        message: 'Database operation failed',
        httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
        isRetryable: true,
        originalError: error,
      };
    }

    return {
      classification: ErrorClassification.SYSTEM,
      code: ErrorCode.UNKNOWN_ERROR,
      message: 'An unexpected error occurred',
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      isRetryable: false,
      originalError: error,
    };
  }

  private classifyHttpException(
    exception: HttpException,
    context?: Record<string, any>,
  ): ClassificationError {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      const code =
        status === HttpStatus.UNAUTHORIZED
          ? ErrorCode.AUTH_FAILED
          : ErrorCode.ACCESS_DENIED;
      const classification =
        status === HttpStatus.UNAUTHORIZED
          ? ErrorClassification.AUTHENTICATION
          : ErrorClassification.AUTHORIZATION;

      return {
        classification,
        code,
        message: this.extractMessage(response),
        httpStatus: status,
        isRetryable: false,
        originalError: exception,
      };
    }

    if (status === HttpStatus.BAD_REQUEST) {
      return {
        classification: ErrorClassification.VALIDATION,
        code: ErrorCode.INVALID_INPUT,
        message: this.extractMessage(response),
        httpStatus: status,
        isRetryable: false,
        originalError: exception,
      };
    }

    if (status === HttpStatus.NOT_FOUND) {
      return {
        classification: ErrorClassification.USER,
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: this.extractMessage(response),
        httpStatus: status,
        isRetryable: false,
        originalError: exception,
      };
    }

    if (status === HttpStatus.CONFLICT) {
      return {
        classification: ErrorClassification.USER,
        code: ErrorCode.DUPLICATE_ENTRY,
        message: this.extractMessage(response),
        httpStatus: status,
        isRetryable: false,
        originalError: exception,
      };
    }

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return {
        classification: ErrorClassification.EXTERNAL_SERVICE,
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Rate limit exceeded. Please try again later.',
        httpStatus: status,
        isRetryable: true,
        originalError: exception,
      };
    }

    return {
      classification: ErrorClassification.SYSTEM,
      code: ErrorCode.UNKNOWN_ERROR,
      message: this.extractMessage(response),
      httpStatus: status,
      isRetryable: status >= 500,
      originalError: exception,
    };
  }

  private isSorobanError(error: Error, message: string): boolean {
    return (
      message.includes('soroban') ||
      message.includes('contract') ||
      message.includes('invoke') ||
      message.includes('wasm') ||
      (error as any).contractId !== undefined ||
      (error as any).sorobanError !== undefined
    );
  }

  private isSdexError(message: string): boolean {
    return (
      message.includes('sdex') ||
      message.includes('orderbook') ||
      message.includes('liquidity') ||
      message.includes('no liquidity') ||
      message.includes('insufficient liquidity')
    );
  }

  private isStellarHorizonError(message: string, stack: string): boolean {
    return (
      message.includes('horizon') ||
      message.includes('stellar') ||
      message.includes('timeout') ||
      message.includes('network') ||
      stack.includes('stellar-sdk') ||
      stack.includes('@stellar')
    );
  }

  private isValidationError(message: string): boolean {
    return (
      message.includes('must be') ||
      message.includes('invalid') ||
      message.includes('required') ||
      message.includes('validation')
    );
  }

  private isDatabaseError(message: string, stack: string): boolean {
    return (
      message.includes('database') ||
      message.includes('query') ||
      message.includes('connection') ||
      stack.includes('typeorm') ||
      stack.includes('postgres') ||
      stack.includes('sequelize')
    );
  }

  private isRetryableSorobanError(message: string): boolean {
    const nonRetryablePatterns = [
      'invalid args',
      'unauthorized',
      'forbidden',
      'not found',
    ];
    return !nonRetryablePatterns.some((p) => message.includes(p));
  }

  private mapSorobanError(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('invalid args')) {
      return 'Invalid contract arguments provided';
    }
    if (message.includes('unauthorized')) {
      return 'Contract authorization failed';
    }
    if (message.includes('not found')) {
      return 'Contract or method not found';
    }
    if (message.includes('wasm')) {
      return 'Contract compilation or execution error';
    }

    return 'Smart contract operation failed. Please try again.';
  }

  private mapSdexError(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('no liquidity')) {
      return 'SDEX market has no available liquidity for this pair';
    }
    if (message.includes('insufficient liquidity')) {
      return 'Insufficient liquidity on SDEX for the requested trade size';
    }
    if (message.includes('timeout')) {
      return 'SDEX request timed out. Please retry.';
    }

    return 'SDEX market data temporarily unavailable';
  }

  private extractMessage(response: any): string {
    if (typeof response === 'string') {
      return response;
    }
    if (typeof response === 'object' && response.message) {
      return response.message;
    }
    return 'An error occurred';
  }

  createErrorResponse(
    error: unknown,
    correlationId?: string,
  ): { statusCode: number; code: string; message: string; timestamp: string } {
    const classification = this.classify(error);

    return {
      statusCode: classification.httpStatus,
      code: classification.code,
      message: classification.message,
      timestamp: new Date().toISOString(),
    };
  }

  logError(metadata: ErrorMetadata): void {
    this.logger.error(metadata.message, undefined, {
      errorClassification: metadata.classification,
      errorCode: metadata.code,
      timestamp: metadata.timestamp,
      path: metadata.path,
      method: metadata.method,
      userId: metadata.userId,
      correlationId: metadata.correlationId,
      originalError: metadata.originalError
        ? {
            name: metadata.originalError.name,
            message: metadata.originalError.message,
          }
        : undefined,
      ...metadata.context,
    });
  }
}