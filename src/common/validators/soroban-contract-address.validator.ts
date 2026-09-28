import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Validates a Soroban smart contract address (C... strkey format).
 *
 * Checks:
 *  1. The value is a non-empty string starting with 'C'.
 *  2. The strkey version byte matches the contract address type (not an
 *     account public key, secret key, or muxed account).
 *  3. The embedded CRC16 checksum is valid (via StrKey.isValidContract).
 *
 * This is a pure local check — no network call is made.
 */
@ValidatorConstraint({ name: 'isSorobanContractAddress', async: false })
export class IsSorobanContractAddressConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (typeof value !== 'string' || !value.startsWith('C')) {
      return false;
    }
    try {
      return StrKey.isValidContract(value);
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return (
      `${args.property} must be a valid Soroban contract address ` +
      `(56-character C... strkey with a valid CRC16 checksum). ` +
      `Account public keys (G...) and other strkey types are not accepted.`
    );
  }
}
