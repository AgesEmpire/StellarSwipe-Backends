import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { isAfter, isBefore } from 'date-fns';

@ValidatorConstraint({ name: 'isValidDateRange', async: false })
export class IsValidDateRangeConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const { startDate, endDate } = value;

    if (!startDate || !endDate) {
      return false;
    }

    try {
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Check if dates are valid
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return false;
      }

      // Check if start date is before end date
      if (!isBefore(start, end)) {
        return false;
      }

      // Check if dates are not too far in the past or future
      const now = new Date();
      const maxPastDate = new Date(now.getFullYear() - 10, 0, 1);
      const maxFutureDate = new Date(now.getFullYear() + 5, 11, 31);

      if (isBefore(start, maxPastDate) || isAfter(end, maxFutureDate)) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must have valid startDate and endDate with startDate before endDate`;
  }
}

@ValidatorConstraint({ name: 'isFutureDate', async: false })
export class IsFutureDateConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments): boolean {
    if (!value) {
      return false;
    }

    try {
      const date = new Date(value);
      
      if (isNaN(date.getTime())) {
        return false;
      }

      const now = new Date();
      return isAfter(date, now);
    } catch (error) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a future date`;
  }
}

@ValidatorConstraint({ name: 'isValidExpirationDate', async: false })
export class IsValidExpirationDateConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments): boolean {
    if (!value) {
      return false;
    }

    try {
      const expirationDate = new Date(value);
      
      if (isNaN(expirationDate.getTime())) {
        return false;
      }

      const now = new Date();
      const maxExpiration = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000)); // 1 year from now

      // Must be in the future but not more than 1 year
      return isAfter(expirationDate, now) && isBefore(expirationDate, maxExpiration);
    } catch (error) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a future date within the next year`;
  }
}

@ValidatorConstraint({ name: 'isValidTimestamp', async: false })
export class IsValidTimestampConstraint implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    try {
      // Handle both Unix timestamp (seconds) and JavaScript timestamp (milliseconds)
      let timestamp: number;
      
      if (typeof value === 'string') {
        timestamp = parseInt(value, 10);
      } else if (typeof value === 'number') {
        timestamp = value;
      } else {
        return false;
      }

      // Convert to milliseconds if it's in seconds
      if (timestamp < 10000000000) {
        timestamp *= 1000;
      }

      const date = new Date(timestamp);
      
      if (isNaN(date.getTime())) {
        return false;
      }

      // Check reasonable bounds (not before 2000 or after 2100)
      const minDate = new Date('2000-01-01');
      const maxDate = new Date('2100-12-31');

      return isAfter(date, minDate) && isBefore(date, maxDate);
    } catch (error) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid timestamp`;
  }
}
