import { Test } from '@nestjs/testing';
import { ExecutionContext, CallHandler, HttpException, HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { RetryAfterInterceptor } from './retry-after.interceptor';
import { RetryAfterService } from '../services/retry-after.service';

describe('RetryAfterInterceptor', () => {
  let interceptor: RetryAfterInterceptor;
  let retryAfterService: RetryAfterService;
  let response: any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [RetryAfterService],
    }).compile();

    retryAfterService = module.get<RetryAfterService>(RetryAfterService);
    interceptor = new RetryAfterInterceptor(retryAfterService);

    response = {
      setHeader: jest.fn(),
      hasHeader: jest.fn().mockReturnValue(false),
    };
  });

  it('should pass through non-429 responses', async () => {
    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(of({ data: 'success' })),
    };

    const context = {
      switchToHttp: jest.fn().mockReturnValue({ getResponse: () => response }),
    } as any;

    await interceptor.intercept(context, mockHandler);

    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('should add Retry-After header to 429 responses', async () => {
    const error = new HttpException(
      { message: 'Too many requests', retryAfter: 60 },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(throwError(() => error)),
    };

    const context = {
      switchToHttp: jest.fn().mockReturnValue({ getResponse: () => response }),
    } as any;

    try {
      await interceptor.intercept(context, mockHandler);
    } catch (e) {
      expect(e).toBe(error);
    }

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('should not override existing Retry-After header', async () => {
    response.hasHeader.mockReturnValue(true);

    const error = new HttpException(
      { message: 'Too many requests', retryAfter: 30 },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(throwError(() => error)),
    };

    const context = {
      switchToHttp: jest.fn().mockReturnValue({ getResponse: () => response }),
    } as any;

    try {
      await interceptor.intercept(context, mockHandler);
    } catch (e) {
      expect(e).toBe(error);
    }

    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('should compute retry-after from resetTime if retryAfter not set', async () => {
    const now = Date.now();
    const resetTime = now + 45000;

    const error = new HttpException(
      { message: 'Too many requests', resetTime },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(throwError(() => error)),
    };

    const context = {
      switchToHttp: jest.fn().mockReturnValue({ getResponse: () => response }),
    } as any;

    try {
      await interceptor.intercept(context, mockHandler);
    } catch (e) {
      expect(e).toBe(error);
    }

    const call = response.setHeader.mock.calls[0];
    expect(call[0]).toBe('Retry-After');
    expect(parseInt(call[1], 10)).toBeGreaterThanOrEqual(44);
    expect(parseInt(call[1], 10)).toBeLessThanOrEqual(46);
  });

  it('should handle errors without retryAfter or resetTime', async () => {
    const error = new HttpException(
      { message: 'Too many requests' },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(throwError(() => error)),
    };

    const context = {
      switchToHttp: jest.fn().mockReturnValue({ getResponse: () => response }),
    } as any;

    try {
      await interceptor.intercept(context, mockHandler);
    } catch (e) {
      expect(e).toBe(error);
    }

    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('should rethrow non-HttpException errors', async () => {
    const error = new Error('Unexpected error');

    const mockHandler: CallHandler = {
      handle: jest.fn().mockReturnValue(throwError(() => error)),
    };

    const context = {
      switchToHttp: jest.fn().mockReturnValue({ getResponse: () => response }),
    } as any;

    await expect(interceptor.intercept(context, mockHandler)).rejects.toBe(error);
  });
});
