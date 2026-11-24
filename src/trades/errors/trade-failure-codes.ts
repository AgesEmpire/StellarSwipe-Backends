import { BadRequestException } from '@nestjs/common';

/**
 * Stable, machine-readable reason codes for trade execution failures (#1527).
 *
 * These values are part of the public API contract: clients may branch on
 * them, so existing codes must never be renamed or repurposed. Add new codes
 * instead. Human-readable messages are safe to show to end users and never
 * contain stack traces, secrets, or raw provider payloads.
 */
export enum TradeFailureCode {
  /** Request or trade parameters failed validation. */
  VALIDATION_FAILED = 'TRADE_VALIDATION_FAILED',
  /** A pending trade already exists for the same user and signal. */
  DUPLICATE_TRADE = 'TRADE_DUPLICATE',
  /** The wallet does not hold enough funds to cover the trade and fees. */
  INSUFFICIENT_BALANCE = 'TRADE_INSUFFICIENT_BALANCE',
  /** The order book / path cannot fill the requested size. */
  INSUFFICIENT_LIQUIDITY = 'TRADE_INSUFFICIENT_LIQUIDITY',
  /** Live price moved beyond the allowed slippage tolerance. */
  SLIPPAGE_EXCEEDED = 'TRADE_SLIPPAGE_EXCEEDED',
  /** A risk or velocity limit blocked the trade. */
  RISK_LIMIT_EXCEEDED = 'TRADE_RISK_LIMIT_EXCEEDED',
  /** A compliance rule blocked the trade. */
  COMPLIANCE_BLOCKED = 'TRADE_COMPLIANCE_BLOCKED',
  /** The execution provider (Horizon / Soroban / DEX) rejected the transaction. */
  PROVIDER_REJECTED = 'TRADE_PROVIDER_REJECTED',
  /** The execution provider was unavailable or returned an unexpected error. */
  PROVIDER_UNAVAILABLE = 'TRADE_PROVIDER_UNAVAILABLE',
  /** The provider did not respond, or the transaction expired, in time. */
  TIMEOUT = 'TRADE_TIMEOUT',
  /** Failure that could not be classified. */
  UNKNOWN = 'TRADE_UNKNOWN_ERROR',
}

export interface TradeFailureDefinition {
  code: TradeFailureCode;
  /** Safe, user-facing message. Stable but may be reworded; clients must branch on `code`. */
  message: string;
  /** Whether retrying the same request later may succeed. */
  retryable: boolean;
}

export const TRADE_FAILURE_CATALOG: Readonly<
  Record<TradeFailureCode, TradeFailureDefinition>
> = Object.freeze({
  [TradeFailureCode.VALIDATION_FAILED]: {
    code: TradeFailureCode.VALIDATION_FAILED,
    message: 'The trade request is invalid.',
    retryable: false,
  },
  [TradeFailureCode.DUPLICATE_TRADE]: {
    code: TradeFailureCode.DUPLICATE_TRADE,
    message: 'A pending trade already exists for this signal.',
    retryable: false,
  },
  [TradeFailureCode.INSUFFICIENT_BALANCE]: {
    code: TradeFailureCode.INSUFFICIENT_BALANCE,
    message: 'Insufficient balance to execute this trade.',
    retryable: false,
  },
  [TradeFailureCode.INSUFFICIENT_LIQUIDITY]: {
    code: TradeFailureCode.INSUFFICIENT_LIQUIDITY,
    message: 'Not enough market liquidity to fill this trade.',
    retryable: true,
  },
  [TradeFailureCode.SLIPPAGE_EXCEEDED]: {
    code: TradeFailureCode.SLIPPAGE_EXCEEDED,
    message: 'The market price moved beyond your slippage tolerance.',
    retryable: true,
  },
  [TradeFailureCode.RISK_LIMIT_EXCEEDED]: {
    code: TradeFailureCode.RISK_LIMIT_EXCEEDED,
    message: 'The trade exceeds your configured risk limits.',
    retryable: false,
  },
  [TradeFailureCode.COMPLIANCE_BLOCKED]: {
    code: TradeFailureCode.COMPLIANCE_BLOCKED,
    message: 'The trade is not permitted by compliance rules.',
    retryable: false,
  },
  [TradeFailureCode.PROVIDER_REJECTED]: {
    code: TradeFailureCode.PROVIDER_REJECTED,
    message: 'The network rejected the trade transaction.',
    retryable: false,
  },
  [TradeFailureCode.PROVIDER_UNAVAILABLE]: {
    code: TradeFailureCode.PROVIDER_UNAVAILABLE,
    message: 'The execution service is temporarily unavailable.',
    retryable: true,
  },
  [TradeFailureCode.TIMEOUT]: {
    code: TradeFailureCode.TIMEOUT,
    message: 'The trade did not complete in time.',
    retryable: true,
  },
  [TradeFailureCode.UNKNOWN]: {
    code: TradeFailureCode.UNKNOWN,
    message: 'The trade could not be executed.',
    retryable: false,
  },
});

/**
 * Ordered classification rules. The first matching rule wins, so more
 * specific patterns (e.g. underfunded) appear before generic ones.
 * Patterns match Stellar result codes and common provider error text.
 */
const CLASSIFICATION_RULES: ReadonlyArray<[RegExp, TradeFailureCode]> = [
  [/timeout|timed out|etimedout|tx_too_late|deadline exceeded|esockettimedout/i, TradeFailureCode.TIMEOUT],
  [/slippage/i, TradeFailureCode.SLIPPAGE_EXCEEDED],
  [/op_underfunded|tx_insufficient_balance|insufficient (balance|funds)|op_low_reserve/i, TradeFailureCode.INSUFFICIENT_BALANCE],
  [/op_too_few_offers|op_over_source_max|op_under_dest_min|no path|insufficient liquidity|liquidity/i, TradeFailureCode.INSUFFICIENT_LIQUIDITY],
  [/compliance|sanction|kyc|aml/i, TradeFailureCode.COMPLIANCE_BLOCKED],
  [/velocity|risk limit|exposure|max position|position limit/i, TradeFailureCode.RISK_LIMIT_EXCEEDED],
  [/duplicate|already exists/i, TradeFailureCode.DUPLICATE_TRADE],
  [/validation|invalid|must be|required/i, TradeFailureCode.VALIDATION_FAILED],
  [/tx_failed|tx_bad_|op_[a-z_]+|rejected|transaction failed/i, TradeFailureCode.PROVIDER_REJECTED],
  [/econnrefused|econnreset|enotfound|503|502|504|unavailable|horizon|soroban|rpc|network/i, TradeFailureCode.PROVIDER_UNAVAILABLE],
];

function extractErrorText(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return [error.name, error.message, typeof code === 'string' ? code : '']
      .filter(Boolean)
      .join(' ');
  }
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return '';
    }
  }
  return String(error);
}

/** Maps any internal/provider error into a stable failure code. */
export function classifyTradeFailure(error: unknown): TradeFailureCode {
  if (isTradeFailureCode(error)) return error;
  const text = extractErrorText(error);
  if (!text) return TradeFailureCode.UNKNOWN;
  for (const [pattern, code] of CLASSIFICATION_RULES) {
    if (pattern.test(text)) return code;
  }
  return TradeFailureCode.UNKNOWN;
}

export function isTradeFailureCode(value: unknown): value is TradeFailureCode {
  return (
    typeof value === 'string' &&
    (Object.values(TradeFailureCode) as string[]).includes(value)
  );
}

export function getTradeFailure(code: TradeFailureCode): TradeFailureDefinition {
  return TRADE_FAILURE_CATALOG[code] ?? TRADE_FAILURE_CATALOG[TradeFailureCode.UNKNOWN];
}

/** Public, sanitized error body returned to clients. */
export interface TradeFailureBody {
  statusCode: number;
  error: string;
  code: TradeFailureCode;
  message: string;
  retryable: boolean;
  tradeId?: string;
}

/**
 * Exception carrying a stable failure code. It deliberately discards the raw
 * cause from the response body; callers should log the cause server-side.
 *
 * HTTP status stays 400 to preserve the existing trade-execution contract.
 */
export class TradeExecutionFailedException extends BadRequestException {
  readonly code: TradeFailureCode;

  constructor(code: TradeFailureCode, tradeId?: string) {
    const def = getTradeFailure(code);
    const body: TradeFailureBody = {
      statusCode: 400,
      error: 'Bad Request',
      code: def.code,
      message: def.message,
      retryable: def.retryable,
      ...(tradeId ? { tradeId } : {}),
    };
    super(body);
    this.code = def.code;
  }

  static fromError(error: unknown, tradeId?: string): TradeExecutionFailedException {
    return new TradeExecutionFailedException(classifyTradeFailure(error), tradeId);
  }
}
