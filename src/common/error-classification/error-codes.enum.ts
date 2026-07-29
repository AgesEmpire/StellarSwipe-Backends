/**
 * ErrorCode enum – values match the canonical error registry exactly.
 * @see src/common/error-registry/error-registry.ts
 *
 * String literals are used directly (not computed from the registry object)
 * because TypeScript enums do not support computed initializers from const
 * objects. The registry spec test enforces that both stay in sync.
 */
export { ErrorCodes } from '../error-registry/error-registry';

export enum ErrorCode {
  // Validation (V1xxx)
  INVALID_INPUT           = 'V1001',
  MISSING_REQUIRED_FIELD  = 'V1002',
  INVALID_FORMAT          = 'V1003',
  INVALID_RANGE           = 'V1004',
  INVALID_ENUM_VALUE      = 'V1005',

  // Authentication (A2xxx)
  AUTH_FAILED             = 'A2001',
  TOKEN_EXPIRED           = 'A2002',
  TOKEN_INVALID           = 'A2003',
  MISSING_CREDENTIALS     = 'A2004',
  ACCOUNT_LOCKED          = 'A2005',

  // Authorization (A3xxx)
  ACCESS_DENIED           = 'A3001',
  INSUFFICIENT_PERMISSIONS = 'A3002',
  FORBIDDEN_RESOURCE      = 'A3003',

  // User / resource (U4xxx)
  RESOURCE_NOT_FOUND      = 'U4001',
  USER_NOT_FOUND          = 'U4002',
  DUPLICATE_ENTRY         = 'U4003',
  BUSINESS_RULE_VIOLATION = 'U4004',

  // System (S5xxx)
  INTERNAL_ERROR          = 'S5001',
  DATABASE_ERROR          = 'S5002',
  CONFIGURATION_ERROR     = 'S5003',
  SERVICE_UNAVAILABLE     = 'S5004',

  // External services (E6xxx)
  SOROBAN_CONTRACT_ERROR  = 'E6001',
  SOROBAN_RPC_ERROR       = 'E6002',
  STELLAR_HORIZON_ERROR   = 'E6003',
  SDEX_LIQUIDITY_ERROR    = 'E6004',
  SDEX_PRICE_ERROR        = 'E6005',
  EXTERNAL_API_ERROR      = 'E6006',
  NETWORK_TIMEOUT         = 'E6007',
  RATE_LIMIT_EXCEEDED     = 'E6008',

  // Unknown (UNxxx)
  UNKNOWN_ERROR           = 'UN001',
}
