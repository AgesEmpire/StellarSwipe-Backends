import { applyDecorators } from '@nestjs/common';
import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Reusable, composed validation constraints for the constraints that show up
 * on almost every request DTO and GraphQL input type in this codebase:
 * nullable rules, string length limits, numeric bounds, and enum membership.
 *
 * These exist so every DTO/input applies the *same* rules the *same* way —
 * e.g. "nullable" always means `@IsOptional()`, never a mix of `nullable:
 * true` on the GraphQL `@Field` with no matching `@IsOptional()`, which is
 * how fields end up validated inconsistently across endpoints.
 */

/** An optional string, bounded to `maxLength` (default 255) and, if given, at least `minLength`. */
export function NullableString(maxLength = 255, minLength = 0): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    IsString(),
    MinLength(minLength),
    MaxLength(maxLength),
  ) as PropertyDecorator;
}

/** A required, non-empty string bounded between `minLength` and `maxLength`. */
export function BoundedString(minLength: number, maxLength: number): PropertyDecorator {
  return applyDecorators(IsString(), MinLength(minLength), MaxLength(maxLength)) as PropertyDecorator;
}

/** An optional number constrained to the inclusive range [min, max]. */
export function NullableBoundedNumber(min: number, max: number): PropertyDecorator {
  return applyDecorators(IsOptional(), IsNumber(), Min(min), Max(max)) as PropertyDecorator;
}

/** A required number constrained to the inclusive range [min, max]. */
export function BoundedNumber(min: number, max: number): PropertyDecorator {
  return applyDecorators(IsNumber(), Min(min), Max(max)) as PropertyDecorator;
}

/** An optional value that must be a member of `enumType` when present. */
export function NullableEnum(enumType: object): PropertyDecorator {
  return applyDecorators(IsOptional(), IsEnum(enumType)) as PropertyDecorator;
}

/** A required value that must be a member of `enumType`. */
export function RequiredEnum(enumType: object): PropertyDecorator {
  return applyDecorators(IsEnum(enumType)) as PropertyDecorator;
}

/** An optional ISO-8601 timestamp string — the common shape for date-range filters. */
export function NullableIsoDate(): PropertyDecorator {
  return applyDecorators(IsOptional(), IsISO8601()) as PropertyDecorator;
}
