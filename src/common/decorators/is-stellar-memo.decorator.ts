import { registerDecorator, ValidationOptions } from 'class-validator';
import { IsStellarMemoConstraint } from '../validators/stellar-memo.validator';

/**
 * Validates that a field holds a valid Stellar memo `{ type, value }` pair,
 * enforcing the per-type byte-length / range constraints before a transaction
 * is handed to the Stellar SDK.
 *
 * @example
 * class BuildPaymentDto {
 *   @IsOptional()
 *   @ValidateNested()
 *   @Type(() => StellarMemoDto)
 *   @IsStellarMemo()
 *   memo?: StellarMemoDto;
 * }
 */
export function IsStellarMemo(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStellarMemoConstraint,
    });
  };
}
