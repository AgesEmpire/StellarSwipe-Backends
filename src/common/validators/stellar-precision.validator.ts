import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isStellarPrecision', async: false })
export class IsStellarPrecisionConstraint
  implements ValidatorConstraintInterface
{
  validate(value: any, args: ValidationArguments): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    const stringValue = String(value);
    if (stringValue.includes('.')) {
      const decimals = stringValue.split('.')[1].length;
      return decimals <= 7;
    }

    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must not exceed 7 decimal places (Stellar precision limit)`;
  }
}
