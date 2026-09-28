/**
 * Error Registry Integrity Test
 *
 * Asserts that:
 *  1. Every backend ErrorCode value appears in ERROR_CODE_TO_SDK_CLASS.
 *  2. Every SDK class name referenced in ERROR_CODE_TO_SDK_CLASS is exported from errors.ts.
 *  3. Every entry in SDK_ERROR_CLASS_MAP corresponds to a code in the canonical registry.
 *  4. The ErrorCode enum values match the registry object values exactly.
 *
 * This test MUST fail if a new error code is added to the registry without updating
 * both the backend mapping and the SDK class map.
 */
import { ErrorCodes, ERROR_CODE_TO_SDK_CLASS, ErrorCodeValue } from '../error-registry/error-registry';
import { ErrorCode } from '../error-classification/error-codes.enum';
import * as SdkErrors from '../../../../sdk/typescript/src/errors';

const ALL_REGISTRY_CODES = Object.values(ErrorCodes) as string[];
const ALL_ENUM_VALUES = Object.values(ErrorCode) as string[];

describe('Error Registry Integrity', () => {
  it('every backend error code has a mapping in ERROR_CODE_TO_SDK_CLASS', () => {
    for (const code of ALL_REGISTRY_CODES) {
      expect(ERROR_CODE_TO_SDK_CLASS[code as ErrorCodeValue]).toBeDefined();
    }
  });

  it('every SDK class name in ERROR_CODE_TO_SDK_CLASS is exported from errors.ts', () => {
    const uniqueClassNames = [...new Set(Object.values(ERROR_CODE_TO_SDK_CLASS))];
    for (const className of uniqueClassNames) {
      expect((SdkErrors as any)[className]).toBeDefined();
    }
  });

  it('every entry in SDK_ERROR_CLASS_MAP has a corresponding backend error code', () => {
    const registryCodes = new Set(ALL_REGISTRY_CODES);
    for (const code of Object.keys(SdkErrors.SDK_ERROR_CLASS_MAP)) {
      expect(registryCodes.has(code)).toBe(true);
    }
  });

  it('ErrorCode enum values are in sync with the registry object', () => {
    const registrySet = new Set(ALL_REGISTRY_CODES);
    for (const val of ALL_ENUM_VALUES) {
      expect(registrySet.has(val)).toBe(true);
    }
    expect(ALL_ENUM_VALUES.length).toBe(ALL_REGISTRY_CODES.length);
  });

  it('resolveErrorClass returns the correct SDK class for known codes', () => {
    expect(SdkErrors.resolveErrorClass('V1001')).toBe(SdkErrors.ValidationError);
    expect(SdkErrors.resolveErrorClass('A2001')).toBe(SdkErrors.AuthenticationError);
    expect(SdkErrors.resolveErrorClass('A3001')).toBe(SdkErrors.AuthorizationError);
    expect(SdkErrors.resolveErrorClass('U4001')).toBe(SdkErrors.NotFoundError);
    expect(SdkErrors.resolveErrorClass('U4003')).toBe(SdkErrors.ConflictError);
    expect(SdkErrors.resolveErrorClass('U4004')).toBe(SdkErrors.BusinessRuleError);
    expect(SdkErrors.resolveErrorClass('S5001')).toBe(SdkErrors.InternalServerError);
    expect(SdkErrors.resolveErrorClass('S5004')).toBe(SdkErrors.ServiceUnavailableError);
    expect(SdkErrors.resolveErrorClass('E6001')).toBe(SdkErrors.StellarContractError);
    expect(SdkErrors.resolveErrorClass('E6003')).toBe(SdkErrors.StellarHorizonError);
    expect(SdkErrors.resolveErrorClass('E6007')).toBe(SdkErrors.NetworkError);
    expect(SdkErrors.resolveErrorClass('E6008')).toBe(SdkErrors.RateLimitError);
  });

  it('resolveErrorClass falls back to APIError for unknown code', () => {
    expect(SdkErrors.resolveErrorClass('UNKNOWN_CODE')).toBe(SdkErrors.APIError);
    expect(SdkErrors.resolveErrorClass(undefined)).toBe(SdkErrors.APIError);
  });

  it('previously-unmapped authorization codes now map to AuthorizationError', () => {
    // A3xxx codes previously fell through to generic APIError — fixed by this registry.
    expect(SdkErrors.resolveErrorClass('A3001')).toBe(SdkErrors.AuthorizationError);
    expect(SdkErrors.resolveErrorClass('A3002')).toBe(SdkErrors.AuthorizationError);
    expect(SdkErrors.resolveErrorClass('A3003')).toBe(SdkErrors.AuthorizationError);
  });
});
