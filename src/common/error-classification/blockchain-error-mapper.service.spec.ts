import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainErrorMapper } from './blockchain-error-mapper.service';
import { ErrorClassification } from './error-classification.enum';
import { ErrorCode } from './error-codes.enum';
import { ErrorClassificationService } from './error-classification.service';
import { LoggerService } from '../logger/logger.service';

describe('BlockchainErrorMapper', () => {
  let mapper: BlockchainErrorMapper;
  let mockClassifier: { classify: jest.Mock };

  beforeEach(async () => {
    mockClassifier = {
      classify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainErrorMapper,
        {
          provide: ErrorClassificationService,
          useValue: mockClassifier,
        },
      ],
    }).compile();

    mapper = module.get<BlockchainErrorMapper>(BlockchainErrorMapper);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('mapSorobanError', () => {
    it('should map auth_failure to authentication classification', () => {
      const result = mapper.mapSorobanError({ code: 'auth_failure' });

      expect(result.code).toBe(ErrorCode.SOROBAN_CONTRACT_ERROR);
      expect(result.classification).toBe(ErrorClassification.AUTHENTICATION);
      expect(result.isRetryable).toBe(false);
    });

    it('should map tx_insufficient_balance to user classification', () => {
      const result = mapper.mapSorobanError({ code: 'tx_insufficient_balance' });

      expect(result.classification).toBe(ErrorClassification.USER);
      expect(result.message).toBe('Insufficient balance for this transaction.');
    });

    it('should map contract_not_found error', () => {
      const result = mapper.mapSorobanError({ code: 'contract_not_found' });

      expect(result.code).toBe(ErrorCode.SOROBAN_CONTRACT_ERROR);
      expect(result.message).toBe('Smart contract not found on the network.');
    });

    it('should map rpc_timeout error', () => {
      const result = mapper.mapSorobanError({ code: 'rpc_timeout' });

      expect(result.code).toBe(ErrorCode.SOROBAN_RPC_ERROR);
      expect(result.isRetryable).toBe(true);
    });

    it('should map timeout in message to orderbook_timeout', () => {
      const result = mapper.mapSorobanError('Request timeout occurred');

      expect(result.code).toBe(ErrorCode.SDEX_PRICE_ERROR);
      expect(result.message).toContain('timed out');
    });

    it('should return default for null/undefined input', () => {
      const result = mapper.mapSorobanError(null);

      expect(result.code).toBe(ErrorCode.SOROBAN_CONTRACT_ERROR);
      expect(result.isRetryable).toBe(true);
    });
  });

  describe('mapSdexError', () => {
    it('should map no_liquidity error', () => {
      const result = mapper.mapSdexError({ code: 'no_liquidity' });

      expect(result.code).toBe(ErrorCode.SDEX_LIQUIDITY_ERROR);
      expect(result.message).toBe('SDEX market has no available liquidity for this pair.');
      expect(result.isRetryable).toBe(true);
    });

    it('should map insufficient_liquidity error', () => {
      const result = mapper.mapSdexError('Insufficient liquidity for trade');

      expect(result.code).toBe(ErrorCode.SDEX_LIQUIDITY_ERROR);
      expect(result.message).toBe('Insufficient liquidity on SDEX for the requested trade size.');
    });

    it('should map timeout errors', () => {
      const result = mapper.mapSdexError('Connection timeout');

      expect(result.code).toBe(ErrorCode.NETWORK_TIMEOUT);
      expect(result.isRetryable).toBe(true);
    });

    it('should return default for null/undefined input', () => {
      const result = mapper.mapSdexError(null);

      expect(result.code).toBe(ErrorCode.SDEX_PRICE_ERROR);
      expect(result.message).toBe('SDEX market data unavailable.');
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('should return user-friendly message for soroban errors', () => {
      const message = mapper.getUserFriendlyMessage({ code: 'auth_failure' }, 'soroban');

      expect(message).toBe('Contract authorization failed. Please check your credentials.');
    });

    it('should return user-friendly message for sdex errors', () => {
      const message = mapper.getUserFriendlyMessage({ code: 'no_liquidity' }, 'sdex');

      expect(message).toBe('SDEX market has no available liquidity for this pair.');
    });
  });
});