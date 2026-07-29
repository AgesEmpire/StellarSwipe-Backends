import { Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ErrorCode } from '../../common/error-classification/error-codes.enum';

interface HorizonErrorResponse {
  status?: number;
  extras?: {
    result_codes?: string[];
    transaction_result_code?: string;
  };
}

@Catch()
export class HorizonExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(HorizonExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const isHorizonError = this.isHorizonApiError(exception);

    if (!isHorizonError) {
      return super.catch(exception, host);
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = this.mapHorizonErrorToHttpStatus(exception);

    const errorResponse = {
      statusCode: status,
      code: this.mapHorizonErrorToCode(exception),
      message: this.extractHorizonErrorMessage(exception),
      ...(process.env.NODE_ENV !== 'production' && {
        debug: { horizonError: this.extractRawHorizonError(exception) },
      }),
    };

    this.logger.warn(`Horizon API error: [${errorResponse.code}] ${errorResponse.message}`, {
      statusCode: status,
      originalError: exception,
    });

    response.status(status).json(errorResponse);
  }

  private isHorizonApiError(exception: unknown): boolean {
    if (!exception || typeof exception !== 'object') {
      return false;
    }

    const err = exception as Record<string, any>;

    // Check for Horizon SDK error patterns
    if (err.response && (err.response.status || err.response.extras)) {
      return true;
    }

    // Check for error message patterns from Horizon
    if (typeof err.message === 'string') {
      return (
        err.message.includes('Horizon') ||
        err.message.includes('horizon') ||
        err.message.includes('result_code') ||
        err.message.includes('transaction_result_code')
      );
    }

    return false;
  }

  private mapHorizonErrorToHttpStatus(exception: unknown): number {
    const err = exception as Record<string, any>;
    const horizonStatus = err.response?.status || err.status;

    if (horizonStatus === 400 || horizonStatus === 'op_underfunded' || horizonStatus === 'tx_failed') {
      return HttpStatus.BAD_REQUEST;
    }
    if (horizonStatus === 401) {
      return HttpStatus.UNAUTHORIZED;
    }
    if (horizonStatus === 403) {
      return HttpStatus.FORBIDDEN;
    }
    if (horizonStatus === 404) {
      return HttpStatus.NOT_FOUND;
    }
    if (horizonStatus === 429) {
      return HttpStatus.TOO_MANY_REQUESTS;
    }
    if (horizonStatus === 503) {
      return HttpStatus.SERVICE_UNAVAILABLE;
    }

    return HttpStatus.BAD_GATEWAY;
  }

  private mapHorizonErrorToCode(exception: unknown): ErrorCode {
    const err = exception as Record<string, any>;
    const horizonStatus = err.response?.status || err.status;
    const resultCodes = err.response?.extras?.result_codes || [];
    const txResultCode = err.response?.extras?.transaction_result_code;

    // Map specific Horizon transaction result codes
    if (resultCodes.length > 0) {
      const firstCode = resultCodes[0];
      if (firstCode === 'op_underfunded' || txResultCode === 'UNDERFUNDED') {
        return ErrorCode.BUSINESS_RULE_VIOLATION;
      }
      if (firstCode.includes('no_trust') || txResultCode?.includes('TRUST')) {
        return ErrorCode.BUSINESS_RULE_VIOLATION;
      }
      if (firstCode.includes('account_not_found') || txResultCode?.includes('ACCOUNT_NOT_FOUND')) {
        return ErrorCode.RESOURCE_NOT_FOUND;
      }
    }

    // Map HTTP status to error code
    if (horizonStatus === 400) {
      return ErrorCode.INVALID_INPUT;
    }
    if (horizonStatus === 401) {
      return ErrorCode.AUTH_FAILED;
    }
    if (horizonStatus === 403) {
      return ErrorCode.ACCESS_DENIED;
    }
    if (horizonStatus === 404) {
      return ErrorCode.RESOURCE_NOT_FOUND;
    }
    if (horizonStatus === 429) {
      return ErrorCode.RATE_LIMIT_EXCEEDED;
    }
    if (horizonStatus === 503) {
      return ErrorCode.SERVICE_UNAVAILABLE;
    }

    return ErrorCode.STELLAR_HORIZON_ERROR;
  }

  private extractHorizonErrorMessage(exception: unknown): string {
    const err = exception as Record<string, any>;

    // Try to extract from various error structures
    if (err.response?.detail) {
      return err.response.detail;
    }
    if (err.message) {
      return err.message;
    }
    if (err.response?.title) {
      return err.response.title;
    }

    return 'An error occurred with the Stellar Horizon API';
  }

  private extractRawHorizonError(exception: unknown): any {
    const err = exception as Record<string, any>;
    return {
      status: err.response?.status || err.status,
      title: err.response?.title,
      detail: err.response?.detail,
      extras: err.response?.extras,
    };
  }
}
