import { SetMetadata } from '@nestjs/common';

export const INTERNAL_FIELD_KEY = Symbol('internal-field');

/**
 * Marks a class property as internal-only, indicating it should be
 * stripped from API responses by the StripInternalFieldsInterceptor.
 *
 * @example
 * class UserEntity {
 *   id: string;
 *
 *   @Internal()
 *   internalRiskScore: number;
 * }
 */
export function Internal() {
  return function (target: any, propertyKey: string) {
    const internalFields = Reflect.getOwnMetadata(INTERNAL_FIELD_KEY, target) || [];
    internalFields.push(propertyKey);
    Reflect.defineMetadata(INTERNAL_FIELD_KEY, internalFields, target);
  };
}

/**
 * Retrieves all properties marked as @Internal() on a given object.
 *
 * @param obj The object instance to inspect.
 * @returns An array of property names marked as internal.
 */
export function getInternalFields(obj: any): string[] {
  if (!obj || typeof obj !== 'object') {
    return [];
  }

  const proto = Object.getPrototypeOf(obj);
  const internalFields = Reflect.getOwnMetadata(INTERNAL_FIELD_KEY, proto) || [];
  return internalFields;
}
