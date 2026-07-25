import { registerDecorator, ValidationOptions } from 'class-validator';
import {
  IsStellarAddressConstraint,
  IsStellarPublicKeyConstraint,
} from '../validators/stellar-address.validator';

export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStellarAddressConstraint,
    });
  };
}

/**
 * Validates that a field is a valid Stellar public key (G... strkey, 56 chars, correct checksum).
 * Rejects secret keys, muxed accounts, wrong-length strings, and malformed checksums.
 */
export function IsStellarPublicKey(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStellarPublicKeyConstraint,
    });
  };
}
