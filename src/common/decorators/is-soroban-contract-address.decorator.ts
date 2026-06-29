import { registerDecorator, ValidationOptions } from 'class-validator';
import { IsSorobanContractAddressConstraint } from '../validators/soroban-contract-address.validator';

/**
 * Validates that a field is a valid Soroban smart contract address.
 *
 * A valid contract address:
 *  - Starts with the letter 'C'
 *  - Carries the contract strkey version byte (not an account public key)
 *  - Passes CRC16 checksum verification
 *
 * Purely local — does not make any network call.
 *
 * @example
 * \@IsSorobanContractAddress()
 * contractId: string;
 */
export function IsSorobanContractAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsSorobanContractAddressConstraint,
    });
  };
}
