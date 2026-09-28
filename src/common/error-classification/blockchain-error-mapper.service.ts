import { Injectable } from '@nestjs/common';
import { ErrorClassification } from './error-classification.enum';
import { ErrorCode } from './error-codes.enum';
import { ErrorClassificationService } from './error-classification.service';

export interface SorobanErrorMapping {
  code: ErrorCode;
  message: string;
  isRetryable: boolean;
  classification: ErrorClassification;
}

export interface SdexErrorMapping {
  code: ErrorCode;
  message: string;
  isRetryable: boolean;
}

@Injectable()
export class BlockchainErrorMapper {
  private readonly sorobanErrorMap: Record<string, SorobanErrorMapping> = {
    'auth_failure': {
      code: ErrorCode.SOROBAN_CONTRACT_ERROR,
      message: 'Contract authorization failed. Please check your credentials.',
      isRetryable: false,
      classification: ErrorClassification.AUTHENTICATION,
    },
    'tx_insufficient_balance': {
      code: ErrorCode.SOROBAN_CONTRACT_ERROR,
      message: 'Insufficient balance for this transaction.',
      isRetryable: false,
      classification: ErrorClassification.USER,
    },
    'contract_not_found': {
      code: ErrorCode.SOROBAN_CONTRACT_ERROR,
      message: 'Smart contract not found on the network.',
      isRetryable: false,
      classification: ErrorClassification.EXTERNAL_SERVICE,
    },
    'invalid_args': {
      code: ErrorCode.SOROBAN_CONTRACT_ERROR,
      message: 'Invalid contract arguments provided.',
      isRetryable: false,
      classification: ErrorClassification.VALIDATION,
    },
    'rpc_timeout': {
      code: ErrorCode.SOROBAN_RPC_ERROR,
      message: 'Soroban RPC request timed out. Please retry.',
      isRetryable: true,
      classification: ErrorClassification.EXTERNAL_SERVICE,
    },
    'rpc_internal_error': {
      code: ErrorCode.SOROBAN_RPC_ERROR,
      message: 'Soroban RPC internal error. Please try again.',
      isRetryable: true,
      classification: ErrorClassification.EXTERNAL_SERVICE,
    },
    'wasm_error': {
      code: ErrorCode.SOROBAN_CONTRACT_ERROR,
      message: 'Smart contract execution failed.',
      isRetryable: false,
      classification: ErrorClassification.EXTERNAL_SERVICE,
    },
  };

  private readonly sdexErrorMap: Record<string, SdexErrorMapping> = {
    'no_liquidity': {
      code: ErrorCode.SDEX_LIQUIDITY_ERROR,
      message: 'SDEX market has no available liquidity for this pair.',
      isRetryable: true,
    },
    'insufficient_liquidity': {
      code: ErrorCode.SDEX_LIQUIDITY_ERROR,
      message: 'Insufficient liquidity on SDEX for the requested trade size.',
      isRetryable: true,
    },
    'price_fetch_failed': {
      code: ErrorCode.SDEX_PRICE_ERROR,
      message: 'Failed to fetch price from SDEX. Please retry.',
      isRetryable: true,
    },
    'orderbook_timeout': {
      code: ErrorCode.SDEX_PRICE_ERROR,
      message: 'SDEX orderbook request timed out.',
      isRetryable: true,
    },
    'network_timeout': {
      code: ErrorCode.NETWORK_TIMEOUT,
      message: 'SDEX network request timed out.',
      isRetryable: true,
    },
  };

  constructor(private readonly classifier: ErrorClassificationService) {}

  mapSorobanError(rawError: any): SorobanErrorMapping {
    if (!rawError) {
      return {
        code: ErrorCode.SOROBAN_CONTRACT_ERROR,
        message: 'Smart contract operation failed.',
        isRetryable: true,
        classification: ErrorClassification.EXTERNAL_SERVICE,
      };
    }

    const errorCode = typeof rawError === 'object' ? rawError.code || rawError.type : null;
    const errorMessage = typeof rawError === 'string' ? rawError : rawError.message || '';

    for (const [key, mapping] of Object.entries(this.sorobanErrorMap)) {
      if (errorMessage.toLowerCase().includes(key) || errorCode === key) {
        return mapping;
      }
    }

    const message = errorMessage.toLowerCase() || 'Unknown error';

    if (message.includes('timeout')) {
      return this.sdexErrorMap['orderbook_timeout'];
    }

    return {
      code: ErrorCode.SOROBAN_CONTRACT_ERROR,
      message: 'Smart contract operation failed. Please try again.',
      isRetryable: true,
      classification: ErrorClassification.EXTERNAL_SERVICE,
    };
  }

  mapSdexError(rawError: any): SdexErrorMapping {
    if (!rawError) {
      return {
        code: ErrorCode.SDEX_PRICE_ERROR,
        message: 'SDEX market data unavailable.',
        isRetryable: true,
      };
    }

    const errorMessage = typeof rawError === 'string' ? rawError : rawError.message || '';

    for (const [key, mapping] of Object.entries(this.sdexErrorMap)) {
      if (errorMessage.toLowerCase().includes(key)) {
        return mapping;
      }
    }

    if (errorMessage.toLowerCase().includes('no liquidity')) {
      return this.sdexErrorMap['no_liquidity'];
    }

    if (errorMessage.toLowerCase().includes('insufficient liquidity')) {
      return this.sdexErrorMap['insufficient_liquidity'];
    }

    if (errorMessage.toLowerCase().includes('timeout')) {
      return this.sdexErrorMap['network_timeout'];
    }

    return {
      code: ErrorCode.SDEX_PRICE_ERROR,
      message: 'SDEX market data temporarily unavailable. Please retry.',
      isRetryable: true,
    };
  }

  getUserFriendlyMessage(error: any, source: 'soroban' | 'sdex'): string {
    if (source === 'soroban') {
      return this.mapSorobanError(error).message;
    }
    return this.mapSdexError(error).message;
  }
}