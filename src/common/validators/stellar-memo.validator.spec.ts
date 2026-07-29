import { ValidationArguments } from 'class-validator';
import {
  IsStellarMemoConstraint,
  StellarMemoType,
} from './stellar-memo.validator';

describe('IsStellarMemoConstraint', () => {
  const constraint = new IsStellarMemoConstraint();
  const args = (value: unknown): ValidationArguments =>
    ({ value, property: 'memo' } as ValidationArguments);

  const validate = (memo: unknown) => constraint.validate(memo, args(memo));

  it('treats null/undefined memo as valid (optionality handled elsewhere)', () => {
    expect(validate(undefined)).toBe(true);
    expect(validate(null)).toBe(true);
  });

  it('rejects non-object memos and unknown types', () => {
    expect(validate('just-a-string')).toBe(false);
    expect(validate({ type: 'bogus', value: 'x' })).toBe(false);
    expect(validate({ value: 'no-type' })).toBe(false);
  });

  describe('NONE', () => {
    it('accepts when there is no value', () => {
      expect(validate({ type: StellarMemoType.NONE })).toBe(true);
      expect(validate({ type: StellarMemoType.NONE, value: '' })).toBe(true);
    });

    it('rejects when a value is supplied', () => {
      expect(validate({ type: StellarMemoType.NONE, value: 'x' })).toBe(false);
    });
  });

  describe('TEXT', () => {
    it('accepts text within 28 bytes', () => {
      expect(validate({ type: StellarMemoType.TEXT, value: 'hello world' })).toBe(
        true,
      );
      expect(
        validate({ type: StellarMemoType.TEXT, value: 'a'.repeat(28) }),
      ).toBe(true);
    });

    it('rejects text exceeding 28 bytes (incl. multi-byte UTF-8)', () => {
      expect(
        validate({ type: StellarMemoType.TEXT, value: 'a'.repeat(29) }),
      ).toBe(false);
      // 10 emoji * 4 bytes = 40 bytes
      expect(
        validate({ type: StellarMemoType.TEXT, value: '😀'.repeat(10) }),
      ).toBe(false);
    });

    it('rejects non-string text values', () => {
      expect(validate({ type: StellarMemoType.TEXT, value: 123 })).toBe(false);
    });
  });

  describe('ID', () => {
    it('accepts a numeric string within the uint64 range', () => {
      expect(validate({ type: StellarMemoType.ID, value: '0' })).toBe(true);
      expect(
        validate({
          type: StellarMemoType.ID,
          value: '18446744073709551615',
        }),
      ).toBe(true);
    });

    it('rejects non-numeric or out-of-range ids', () => {
      expect(validate({ type: StellarMemoType.ID, value: 'abc' })).toBe(false);
      expect(validate({ type: StellarMemoType.ID, value: '-1' })).toBe(false);
      expect(
        validate({
          type: StellarMemoType.ID,
          value: '18446744073709551616', // 2^64
        }),
      ).toBe(false);
    });
  });

  describe('HASH / RETURN', () => {
    const hash = 'a'.repeat(64);

    it('accepts a 64-char hex hash', () => {
      expect(validate({ type: StellarMemoType.HASH, value: hash })).toBe(true);
      expect(validate({ type: StellarMemoType.RETURN, value: hash })).toBe(true);
    });

    it('rejects wrong-length or non-hex hashes', () => {
      expect(validate({ type: StellarMemoType.HASH, value: 'a'.repeat(63) })).toBe(
        false,
      );
      expect(
        validate({ type: StellarMemoType.HASH, value: 'z'.repeat(64) }),
      ).toBe(false);
      expect(validate({ type: StellarMemoType.RETURN, value: '' })).toBe(false);
    });
  });
});
