import { HttpStatus } from '@nestjs/common';
import { HorizonExceptionFilter } from './horizon-error.filter';
import { ErrorCode } from '../../common/error-classification/error-codes.enum';

describe('HorizonExceptionFilter', () => {
  let filter: HorizonExceptionFilter;
  let mockResponse: any;
  let mockArgumentsHost: any;

  beforeEach(() => {
    filter = new HorizonExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    };
  });

  describe('catch - Horizon errors', () => {
    it('should map account_not_found error to 404', () => {
      const horizonError = {
        response: {
          status: 404,
          extras: {
            result_codes: ['account_not_found'],
          },
        },
        message: 'Account not found',
      };

      filter.catch(horizonError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.RESOURCE_NOT_FOUND,
        }),
      );
    });

    it('should map op_underfunded error to 400 with BUSINESS_RULE_VIOLATION', () => {
      const horizonError = {
        response: {
          status: 400,
          extras: {
            result_codes: ['op_underfunded'],
          },
        },
        message: 'Operation underfunded',
      };

      filter.catch(horizonError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.BUSINESS_RULE_VIOLATION,
        }),
      );
    });

    it('should map no_trust error to BUSINESS_RULE_VIOLATION', () => {
      const horizonError = {
        response: {
          status: 400,
          extras: {
            result_codes: ['no_trust'],
          },
        },
        message: 'No trust',
      };

      filter.catch(horizonError, mockArgumentsHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.BUSINESS_RULE_VIOLATION,
        }),
      );
    });

    it('should map rate limit error (429) correctly', () => {
      const horizonError = {
        response: {
          status: 429,
        },
        message: 'Rate limited',
      };

      filter.catch(horizonError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.RATE_LIMIT_EXCEEDED,
        }),
      );
    });

    it('should map service unavailable (503) error', () => {
      const horizonError = {
        response: {
          status: 503,
        },
        message: 'Service unavailable',
      };

      filter.catch(horizonError, mockArgumentsHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCode.SERVICE_UNAVAILABLE,
        }),
      );
    });

    it('should include debug info in non-production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const horizonError = {
        response: {
          status: 400,
          title: 'Bad Request',
          detail: 'Invalid transaction',
        },
        message: 'Invalid transaction',
      };

      filter.catch(horizonError, mockArgumentsHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          debug: expect.objectContaining({
            horizonError: expect.any(Object),
          }),
        }),
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should extract error message from response detail', () => {
      const horizonError = {
        response: {
          status: 400,
          detail: 'Specific Horizon error detail',
        },
      };

      filter.catch(horizonError, mockArgumentsHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Specific Horizon error detail',
        }),
      );
    });
  });

  describe('isHorizonApiError', () => {
    it('should identify Horizon SDK errors', () => {
      const horizonError = {
        response: {
          status: 400,
          extras: { result_codes: ['op_underfunded'] },
        },
      };

      const isHorizonError = filter['isHorizonApiError'](horizonError);
      expect(isHorizonError).toBe(true);
    });

    it('should identify errors by message pattern', () => {
      const horizonError = {
        message: 'Horizon returned an error',
      };

      const isHorizonError = filter['isHorizonApiError'](horizonError);
      expect(isHorizonError).toBe(true);
    });

    it('should not identify unrelated errors as Horizon errors', () => {
      const regularError = {
        message: 'Some database error',
        code: 'ECONNREFUSED',
      };

      const isHorizonError = filter['isHorizonApiError'](regularError);
      expect(isHorizonError).toBe(false);
    });
  });
});
