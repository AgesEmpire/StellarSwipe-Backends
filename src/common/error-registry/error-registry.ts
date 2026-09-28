/**
 * Canonical error code registry shared between the backend and SDK.
 *
 * ADDING A NEW ERROR CODE:
 *  1. Add the code string here in the appropriate category.
 *  2. Add a mapping entry in ERROR_CODE_TO_SDK_CLASS below.
 *  3. Add the corresponding SDK error class in sdk/typescript/src/errors.ts
 *     (or reuse an existing one if semantically equivalent).
 *  4. The test `error-registry.spec.ts` will fail if step 2 or 3 is missing,
 *     preventing the registry from going out of sync.
 */
export const ErrorCodes = {
  // Validation (V1xxx)
  INVALID_INPUT: 'V1001',
  MISSING_REQUIRED_FIELD: 'V1002',
  INVALID_FORMAT: 'V1003',
  INVALID_RANGE: 'V1004',
  INVALID_ENUM_VALUE: 'V1005',

  // Authentication (A2xxx)
  AUTH_FAILED: 'A2001',
  TOKEN_EXPIRED: 'A2002',
  TOKEN_INVALID: 'A2003',
  MISSING_CREDENTIALS: 'A2004',
  ACCOUNT_LOCKED: 'A2005',

  // Authorization (A3xxx)
  ACCESS_DENIED: 'A3001',
  INSUFFICIENT_PERMISSIONS: 'A3002',
  FORBIDDEN_RESOURCE: 'A3003',

  // User / resource (U4xxx)
  RESOURCE_NOT_FOUND: 'U4001',
  USER_NOT_FOUND: 'U4002',
  DUPLICATE_ENTRY: 'U4003',
  BUSINESS_RULE_VIOLATION: 'U4004',

  // System (S5xxx)
  INTERNAL_ERROR: 'S5001',
  DATABASE_ERROR: 'S5002',
  CONFIGURATION_ERROR: 'S5003',
  SERVICE_UNAVAILABLE: 'S5004',

  // External services (E6xxx)
  SOROBAN_CONTRACT_ERROR: 'E6001',
  SOROBAN_RPC_ERROR: 'E6002',
  STELLAR_HORIZON_ERROR: 'E6003',
  SDEX_LIQUIDITY_ERROR: 'E6004',
  SDEX_PRICE_ERROR: 'E6005',
  EXTERNAL_API_ERROR: 'E6006',
  NETWORK_TIMEOUT: 'E6007',
  RATE_LIMIT_EXCEEDED: 'E6008',

  // Unknown (UNxxx)
  UNKNOWN_ERROR: 'UN001',
} as const;

export type ErrorCodeValue = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Canonical mapping from every backend error code to its SDK error class name.
 * This is the single source of truth consumed by the SDK's error-mapping logic.
 *
 * SDK class names must correspond to exported classes in sdk/typescript/src/errors.ts.
 */
export const ERROR_CODE_TO_SDK_CLASS: Record<ErrorCodeValue, string> = {
  // Validation → ValidationError
  V1001: 'ValidationError',
  V1002: 'ValidationError',
  V1003: 'ValidationError',
  V1004: 'ValidationError',
  V1005: 'ValidationError',

  // Authentication → AuthenticationError
  A2001: 'AuthenticationError',
  A2002: 'AuthenticationError',
  A2003: 'AuthenticationError',
  A2004: 'AuthenticationError',
  A2005: 'AuthenticationError',

  // Authorization → AuthorizationError (previously unmapped — fixed here)
  A3001: 'AuthorizationError',
  A3002: 'AuthorizationError',
  A3003: 'AuthorizationError',

  // User / resource → NotFoundError or ConflictError
  U4001: 'NotFoundError',
  U4002: 'NotFoundError',
  U4003: 'ConflictError',
  U4004: 'BusinessRuleError',

  // System → InternalServerError
  S5001: 'InternalServerError',
  S5002: 'InternalServerError',
  S5003: 'InternalServerError',
  S5004: 'ServiceUnavailableError',

  // External → StellarError / RateLimitError / NetworkError
  E6001: 'StellarContractError',
  E6002: 'StellarContractError',
  E6003: 'StellarHorizonError',
  E6004: 'StellarError',
  E6005: 'StellarError',
  E6006: 'APIError',
  E6007: 'NetworkError',
  E6008: 'RateLimitError',

  UN001: 'APIError',
};
