import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { validate, ValidationError } from 'class-validator';
import { plainToInstance, ClassConstructor } from 'class-transformer';

/**
 * Flattens a tree of class-validator ValidationErrors into a plain object
 * keyed by dot-notation path (e.g. `"address.city": ["must be a string"]`).
 */
function flattenErrors(
  errors: ValidationError[],
  prefix = '',
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const err of errors) {
    const path = prefix ? `${prefix}.${err.property}` : err.property;

    if (err.constraints && Object.keys(err.constraints).length > 0) {
      result[path] = Object.values(err.constraints);
    }

    if (err.children && err.children.length > 0) {
      Object.assign(result, flattenErrors(err.children, path));
    }
  }

  return result;
}

/**
 * NestedPayloadValidator
 *
 * Validates arbitrarily-deep nested request payloads against a DTO class.
 * Addresses the gap where the existing CustomValidationPipe only validates
 * the top-level object — nested objects decorated with @ValidateNested()
 * are fully traversed here.
 *
 * Key options applied:
 *  - `whitelist: true`          — strips undeclared properties
 *  - `forbidNonWhitelisted: true` — rejects requests with extra properties
 *  - `enableImplicitConversion: true` — coerces primitive types (string→number etc.)
 *  - `stopAtFirstError: false`  — collects all errors before throwing
 *
 * Security: preserves existing access-control semantics — no auth/authz
 * logic is touched.  Stripping undeclared properties prevents mass-assignment
 * attacks on nested objects that the middleware layer cannot catch.
 *
 * Usage:
 *   const validated = await this.nestedPayloadValidator.validate(CreateOrderDto, body);
 */
@Injectable()
export class NestedPayloadValidator {
  private readonly logger = new Logger(NestedPayloadValidator.name);

  /**
   * Transform `plain` into an instance of `cls` and run full nested validation.
   *
   * @throws BadRequestException with a structured `errors` map when validation fails.
   * @returns The validated (and whitelist-stripped) class instance.
   */
  async validate<T extends object>(
    cls: ClassConstructor<T>,
    plain: unknown,
  ): Promise<T> {
    const instance = plainToInstance(cls, plain, {
      enableImplicitConversion: true,
      excludeExtraneousValues: false, // rely on whitelist instead
    });

    const errors = await validate(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    });

    if (errors.length > 0) {
      const flat = flattenErrors(errors);
      this.logger.warn(
        `Nested payload validation failed for ${cls.name}: ${JSON.stringify(flat)}`,
      );
      throw new BadRequestException({
        message: 'Validation failed',
        errors: flat,
      });
    }

    return instance;
  }
}

export { flattenErrors };
