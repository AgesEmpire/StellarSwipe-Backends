import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Stellar memo types as defined by the protocol / Stellar SDK.
 *
 * @see https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/memos
 */
export enum StellarMemoType {
  NONE = 'none',
  TEXT = 'text',
  ID = 'id',
  HASH = 'hash',
  RETURN = 'return',
}

/** MEMO_TEXT is limited to 28 bytes of UTF-8 encoded text. */
export const MEMO_TEXT_MAX_BYTES = 28;

/** MEMO_HASH / MEMO_RETURN are 32-byte hashes encoded as 64 hex characters. */
export const MEMO_HASH_HEX_LENGTH = 64;

/** MEMO_ID is an unsigned 64-bit integer. */
export const MEMO_ID_MAX = 18446744073709551615n; // 2^64 - 1

const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;

/**
 * The shape a memo DTO must expose for {@link IsStellarMemo} to validate it.
 */
export interface StellarMemoLike {
  type?: unknown;
  value?: unknown;
}

/**
 * Validates a memo `{ type, value }` pair against Stellar's per-type
 * constraints before a transaction is built.
 *
 * Rules:
 * - `none`   — no value (must be empty/absent).
 * - `text`   — string, max 28 bytes when UTF-8 encoded.
 * - `id`     — numeric string within the unsigned 64-bit range.
 * - `hash`   — 32-byte hash encoded as 64 hex characters.
 * - `return` — 32-byte hash encoded as 64 hex characters.
 */
@ValidatorConstraint({ name: 'isStellarMemo', async: false })
export class IsStellarMemoConstraint implements ValidatorConstraintInterface {
  validate(memo: unknown, _args: ValidationArguments): boolean {
    if (memo === null || memo === undefined) {
      // Optionality is handled by @IsOptional on the field; an absent memo is
      // considered valid here.
      return true;
    }

    if (typeof memo !== 'object') {
      return false;
    }

    const { type, value } = memo as StellarMemoLike;

    switch (type) {
      case StellarMemoType.NONE:
        return value === undefined || value === null || value === '';

      case StellarMemoType.TEXT:
        return (
          typeof value === 'string' &&
          Buffer.byteLength(value, 'utf8') <= MEMO_TEXT_MAX_BYTES
        );

      case StellarMemoType.ID:
        return this.isValidMemoId(value);

      case StellarMemoType.HASH:
      case StellarMemoType.RETURN:
        return typeof value === 'string' && HEX_32_BYTES.test(value);

      default:
        // Unknown / missing memo type.
        return false;
    }
  }

  private isValidMemoId(value: unknown): boolean {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return false;
    }

    const str = String(value);
    if (!/^\d+$/.test(str)) {
      return false;
    }

    try {
      const id = BigInt(str);
      return id >= 0n && id <= MEMO_ID_MAX;
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const memo = args.value as StellarMemoLike | undefined;
    const type = memo?.type;

    switch (type) {
      case StellarMemoType.TEXT:
        return `${args.property} text memo must not exceed ${MEMO_TEXT_MAX_BYTES} bytes (UTF-8)`;
      case StellarMemoType.ID:
        return `${args.property} id memo must be a numeric string within the unsigned 64-bit range`;
      case StellarMemoType.HASH:
      case StellarMemoType.RETURN:
        return `${args.property} ${String(type)} memo must be a 32-byte hash encoded as ${MEMO_HASH_HEX_LENGTH} hex characters`;
      case StellarMemoType.NONE:
        return `${args.property} none memo must not carry a value`;
      default:
        return `${args.property} must specify a valid Stellar memo type (${Object.values(
          StellarMemoType,
        ).join(', ')})`;
    }
  }
}
