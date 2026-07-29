import { Test, TestingModule } from '@nestjs/testing';
import { ErrorClassificationService } from './error-classification.service';
import { ErrorClassification } from './error-classification.enum';
import { ErrorCode } from './error-codes.enum';
import { HttpStatus, HttpException } from '@nestjs/common';
import { ValidationException, AuthenticationException, ExternalApiException, InternalException } from './custom-exceptions';
import { LoggerService } from '../logger/logger.service';

describe('ErrorClassificationService', () => {
  let service: ErrorClassificationService;
  let mockLogger: { error: jest.Mock; warn: jest.Mock; setContext: jest.Mock };

  beforeEach(async () => {
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      setContext: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorClassificationService,
        {
          provide: LoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<ErrorClassificationService>(ErrorClassificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('classify', () => {
    it('should classify validation errors correctly', () => {
      const error = new ValidationException('Invalid input provided');
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.VALIDATION);
      expect(result.code).toBe(ErrorCode.INVALID_INPUT);
      expect(result.httpStatus).toBe(HttpStatus.BAD_REQUEST);
      expect(result.isRetryable).toBe(false);
    });

    it('should classify authentication errors correctly', () => {
      const error = new AuthenticationException('Token expired');
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.AUTHENTICATION);
      expect(result.code).toBe(ErrorCode.AUTH_FAILED);
      expect(result.httpStatus).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('should classify external API errors correctly', () => {
      const error = new ExternalApiException('API request failed', ErrorCode.EXTERNAL_API_ERROR, HttpStatus.BAD_GATEWAY, true);
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.EXTERNAL_SERVICE);
      expect(result.code).toBe(ErrorCode.EXTERNAL_API_ERROR);
      expect(result.httpStatus).toBe(HttpStatus.BAD_GATEWAY);
      expect(result.isRetryable).toBe(true);
    });

    it('should classify internal errors correctly', () => {
      const error = new InternalException('Database connection failed');
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.SYSTEM);
      expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(result.httpStatus).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(result.isRetryable).toBe(true);
    });

    it('should classify standard Error as unknown', () => {
      const error = new Error('Something went wrong');
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.SYSTEM);
      expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it('should classify Soroban contract errors', () => {
      const error = new Error('Soroban contract invocation failed for contract 123');
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.EXTERNAL_SERVICE);
      expect(result.code).toBe(ErrorCode.SOROBAN_CONTRACT_ERROR);
      expect(result.httpStatus).toBe(HttpStatus.BAD_GATEWAY);
      expect(result.isRetryable).toBe(true);
    });

    it('should classify SDEX liquidity errors', () => {
      const error = new Error('No liquidity on SDEX for XLM-USDC');
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.EXTERNAL_SERVICE);
      expect(result.code).toBe(ErrorCode.SDEX_PRICE_ERROR);
      expect(result.isRetryable).toBe(true);
    });

    it('should classify SDEX insufficient liquidity errors', () => {
      const error = new Error('Insufficient liquidity: only 10 available');
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.EXTERNAL_SERVICE);
      expect(result.code).toBe(ErrorCode.SDEX_LIQUIDITY_ERROR);
    });

    it('should classify Stellar Horizon errors', () => {
      const error = new Error('Horizon timeout occurred');
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.EXTERNAL_SERVICE);
      expect(result.code).toBe(ErrorCode.STELLAR_HORIZON_ERROR);
    });

    it('should classify database errors', () => {
      const error = new Error('Database connection failed') as any;
      error.stack = 'Error: Database connection failed\n    at QueryRunner';
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.SYSTEM);
      expect(result.code).toBe(ErrorCode.DATABASE_ERROR);
    });

    it('should classify unknown exceptions', () => {
      const result = service.classify('random string error');

      expect(result.classification).toBe(ErrorClassification.SYSTEM);
      expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it('should classify HttpException with 404 status', () => {
      const error = new HttpException('Resource not found', HttpStatus.NOT_FOUND);
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.USER);
      expect(result.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    });

    it('should classify HttpException with 403 status', () => {
      const error = new HttpException(
        { message: 'Access denied', error: 'Forbidden' },
        HttpStatus.FORBIDDEN,
      );
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.AUTHORIZATION);
      expect(result.code).toBe(ErrorCode.ACCESS_DENIED);
    });

    it('should classify HttpException with 429 status', () => {
      const error = new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      const result = service.classify(error);

      expect(result.classification).toBe(ErrorClassification.EXTERNAL_SERVICE);
      expect(result.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(result.isRetryable).toBe(true);
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response with correct structure', () => {
      const error = new ValidationException('Test validation error');
      const response = service.createErrorResponse(error, 'test-correlation-id');

      expect(response).toEqual({
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.INVALID_INPUT,
        message: 'Test validation error',
        timestamp: expect.any(String),
      });
    });

    it('should include correlationId in logged metadata', () => {
      const error = new Error('Test error');
      service.logError({
        classification: ErrorClassification.SYSTEM,
        code: ErrorCode.UNKNOWN_ERROR,
        timestamp: new Date().toISOString(),
        correlationId: 'test-correlation-id',
        originalError: error,
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'An unexpected error occurred',
        undefined,
        expect.objectContaining({
          correlationId: 'test-correlation-id',
        }),
      );
    });
  });
});