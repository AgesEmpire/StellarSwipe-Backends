import { registerDecorator, ValidationOptions } from 'class-validator';
import { IsStellarPrecisionConstraint } from '../validators/stellar-precision.validator';

export function IsStellarPrecision(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStellarPrecisionConstraint,
    });
  };
}
