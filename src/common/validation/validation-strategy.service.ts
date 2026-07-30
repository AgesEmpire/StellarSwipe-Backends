import { Injectable, BadRequestException } from '@nestjs/common';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate, ValidatorOptions } from 'class-validator';
import { formatValidationErrors } from './validation-error-formatter';

const DEFAULT_VALIDATOR_OPTIONS: ValidatorOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  validateCustomDecorators: true,
  stopAtFirstError: false,
};

/**
 * Reusable validation entry point for request DTOs *and* GraphQL input
 * types, so both go through the same rules and produce the same error shape
 * (`{ message, errors: { field: [messages] } }`) as `CustomValidationPipe`.
 *
 * `CustomValidationPipe` covers the common case — a controller/resolver
 * argument with a class-validator-decorated metatype, validated
 * automatically by Nest's pipe pipeline. This service exists for the cases
 * that pipeline doesn't reach on its own:
 *
 * - Ad-hoc/dynamic payloads (e.g. a JSON scalar field, a nested object built
 *   up inside a resolver) that need the same constraints applied explicitly.
 * - Validating a DTO instance a service constructs internally before
 *   persisting it, without round-tripping through an HTTP/GraphQL argument.
 */
@Injectable()
export class ValidationStrategyService {
  /**
   * Validates `payload` against `cls`'s class-validator decorators.
   * Throws BadRequestException (same shape as CustomValidationPipe) on
   * failure; returns the transformed, validated instance on success.
   */
  async validate<T extends object>(
    cls: ClassConstructor<T>,
    payload: unknown,
    options: ValidatorOptions = {},
  ): Promise<T> {
    const instance = plainToInstance(cls, payload);
    const errors = await validate(instance, { ...DEFAULT_VALIDATOR_OPTIONS, ...options });

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: formatValidationErrors(errors),
      });
    }

    return instance;
  }

  /** Same as {@link validate}, but returns `{ valid, errors }` instead of throwing. */
  async safeValidate<T extends object>(
    cls: ClassConstructor<T>,
    payload: unknown,
    options: ValidatorOptions = {},
  ): Promise<{ valid: boolean; value: T; errors: Record<string, unknown> }> {
    const instance = plainToInstance(cls, payload);
    const errors = await validate(instance, { ...DEFAULT_VALIDATOR_OPTIONS, ...options });

    return {
      valid: errors.length === 0,
      value: instance,
      errors: formatValidationErrors(errors),
    };
  }
}
