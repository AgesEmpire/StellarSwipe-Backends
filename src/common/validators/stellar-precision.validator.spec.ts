import { ValidationArguments } from 'class-validator';
import { IsStellarPrecisionConstraint } from './stellar-precision.validator';

describe('IsStellarPrecisionConstraint', () => {
  const constraint = new IsStellarPrecisionConstraint();
  const args = (value: unknown): ValidationArguments =>
    ({ value, property: 'amount' } as ValidationArguments);

  const validate = (amount: unknown) => constraint.validate(amount, args(amount));

  describe('null/undefined values', () => {
    it('treats null as valid (optionality handled elsewhere)', () => {
      expect(validate(null)).toBe(true);
    });

    it('treats undefined as valid (optionality handled elsewhere)', () => {
      expect(validate(undefined)).toBe(true);
    });
  });

  describe('values at or below precision limit', () => {
    it('accepts whole numbers', () => {
      expect(validate(100)).toBe(true);
      expect(validate('1000')).toBe(true);
    });

    it('accepts amounts with exactly 7 decimal places', () => {
      expect(validate('1.2345678')).toBe(false);
      expect(validate('100.1234567')).toBe(true);
      expect(validate('0.0000001')).toBe(true);
    });

    it('accepts amounts with fewer than 7 decimal places', () => {
      expect(validate('100.1')).toBe(true);
      expect(validate('100.12345')).toBe(true);
      expect(validate('100.123456')).toBe(true);
    });

    it('accepts amounts represented as numbers', () => {
      expect(validate(100.12345)).toBe(true);
      expect(validate(100.1)).toBe(true);
    });
  });

  describe('values exceeding precision limit', () => {
    it('rejects amounts with 8 decimal places', () => {
      expect(validate('100.12345678')).toBe(false);
      expect(validate('0.00000001')).toBe(false);
    });

    it('rejects amounts with more than 8 decimal places', () => {
      expect(validate('100.123456789')).toBe(false);
      expect(validate('100.123456789012345')).toBe(false);
    });
  });

  describe('error message', () => {
    it('returns a clear error message', () => {
      const message = constraint.defaultMessage(args('100.12345678'));
      expect(message).toContain('7 decimal places');
      expect(message).toContain('Stellar precision limit');
    });
  });
});
