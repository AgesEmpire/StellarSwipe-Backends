import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.enum';

export class ValidationException extends HttpException {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INVALID_INPUT,
    details?: any,
  ) {
    super(
      {
        message,
        code,
        error: 'Validation',
        details,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class AuthenticationException extends HttpException {
  constructor(
    message: string = 'Authentication failed',
    code: ErrorCode = ErrorCode.AUTH_FAILED,
  ) {
    super(
      {
        message,
        code,
        error: 'Authentication',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class ExternalApiException extends HttpException {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.EXTERNAL_API_ERROR,
    httpStatus: HttpStatus = HttpStatus.BAD_GATEWAY,
    retryable: boolean = true,
  ) {
    super(
      {
        message,
        code,
        error: 'ExternalApi',
        retryable,
      },
      httpStatus,
    );
  }
}

export class InternalException extends HttpException {
  constructor(
    message: string = 'Internal server error',
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
  ) {
    super(
      {
        message,
        code,
        error: 'Internal',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}