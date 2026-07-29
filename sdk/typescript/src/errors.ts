/**
 * SDK error classes for StellarSwipe.
 *
 * Each class corresponds to one or more backend error codes defined in the
 * canonical registry (src/common/error-registry/error-registry.ts).
 * The mapping is enforced by the test error-registry.spec.ts.
 */

export class StellarSwipeError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly details?: any;

  constructor(message: string, status?: number, code?: string, details?: any) {
    super(message);
    this.name = 'StellarSwipeError';
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, StellarSwipeError.prototype);
  }
}

export class APIError extends StellarSwipeError {
  constructor(message: string, status: number, details?: any) {
    super(message, status, 'API_ERROR', details);
    this.name = 'APIError';
    Object.setPrototypeOf(this, APIError.prototype);
  }
}

export class AuthenticationError extends StellarSwipeError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/** Previously unmapped – covers A3xxx authorization codes. */
export class AuthorizationError extends StellarSwipeError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

export class ValidationError extends StellarSwipeError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends StellarSwipeError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with ID ${id} not found` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/** Previously unmapped – covers U4003 DUPLICATE_ENTRY. */
export class ConflictError extends StellarSwipeError {
  constructor(message: string = 'Conflict') {
    super(message, 409, 'CONFLICT_ERROR');
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/** Previously unmapped – covers U4004 BUSINESS_RULE_VIOLATION. */
export class BusinessRuleError extends StellarSwipeError {
  constructor(message: string) {
    super(message, 422, 'BUSINESS_RULE_ERROR');
    this.name = 'BusinessRuleError';
    Object.setPrototypeOf(this, BusinessRuleError.prototype);
  }
}

export class RateLimitError extends StellarSwipeError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 429, 'RATE_LIMIT_ERROR');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class NetworkError extends StellarSwipeError {
  constructor(message: string = 'Network request failed') {
    super(message, undefined, 'NETWORK_ERROR');
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/** Previously unmapped – covers S5001-S5003. */
export class InternalServerError extends StellarSwipeError {
  constructor(message: string = 'Internal server error') {
    super(message, 500, 'INTERNAL_SERVER_ERROR');
    this.name = 'InternalServerError';
    Object.setPrototypeOf(this, InternalServerError.prototype);
  }
}

/** Previously unmapped – covers S5004 SERVICE_UNAVAILABLE. */
export class ServiceUnavailableError extends StellarSwipeError {
  constructor(message: string = 'Service unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE_ERROR');
    this.name = 'ServiceUnavailableError';
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
}

/** Previously unmapped – covers E6001/E6002 Soroban contract errors. */
export class StellarContractError extends StellarSwipeError {
  constructor(message: string = 'Smart contract operation failed') {
    super(message, 502, 'STELLAR_CONTRACT_ERROR');
    this.name = 'StellarContractError';
    Object.setPrototypeOf(this, StellarContractError.prototype);
  }
}

/** Previously unmapped – covers E6003 Horizon errors. */
export class StellarHorizonError extends StellarSwipeError {
  constructor(message: string = 'Stellar Horizon error') {
    super(message, 502, 'STELLAR_HORIZON_ERROR');
    this.name = 'StellarHorizonError';
    Object.setPrototypeOf(this, StellarHorizonError.prototype);
  }
}

/** Covers E6004/E6005 SDEX errors. */
export class StellarError extends StellarSwipeError {
  constructor(message: string = 'Stellar operation failed') {
    super(message, 502, 'STELLAR_ERROR');
    this.name = 'StellarError';
    Object.setPrototypeOf(this, StellarError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Registry-driven error mapping
// ---------------------------------------------------------------------------

/**
 * Map of every backend error code value → SDK error class constructor.
 * Consumed by handleErrorResponse in client.ts to throw the correct type.
 */
export const SDK_ERROR_CLASS_MAP: Record<string, new (...args: any[]) => StellarSwipeError> = {
  V1001: ValidationError,
  V1002: ValidationError,
  V1003: ValidationError,
  V1004: ValidationError,
  V1005: ValidationError,

  A2001: AuthenticationError,
  A2002: AuthenticationError,
  A2003: AuthenticationError,
  A2004: AuthenticationError,
  A2005: AuthenticationError,

  A3001: AuthorizationError,
  A3002: AuthorizationError,
  A3003: AuthorizationError,

  U4001: NotFoundError,
  U4002: NotFoundError,
  U4003: ConflictError,
  U4004: BusinessRuleError,

  S5001: InternalServerError,
  S5002: InternalServerError,
  S5003: InternalServerError,
  S5004: ServiceUnavailableError,

  E6001: StellarContractError,
  E6002: StellarContractError,
  E6003: StellarHorizonError,
  E6004: StellarError,
  E6005: StellarError,
  E6006: APIError,
  E6007: NetworkError,
  E6008: RateLimitError,

  UN001: APIError,
};

/**
 * Resolves the correct SDK error class for a backend error code.
 * Falls back to APIError for any unknown code.
 */
export function resolveErrorClass(
  code: string | undefined,
): new (...args: any[]) => StellarSwipeError {
  return (code && SDK_ERROR_CLASS_MAP[code]) || APIError;
}
