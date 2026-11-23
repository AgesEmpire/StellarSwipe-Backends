import { ValidationError } from 'class-validator';

/** Recursively shapes `class-validator` errors into `{ field: [messages] }`, including nested DTOs. */
export function formatValidationErrors(errors: ValidationError[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const error of errors) {
    if (error.children && error.children.length > 0) {
      result[error.property] = formatValidationErrors(error.children);
    } else {
      result[error.property] = Object.values(error.constraints || {});
    }
  }

  return result;
}

/**
 * One failed rule. `rule` is the stable machine-readable identifier (the
 * class-validator constraint name, e.g. `isString`, `minLength`); `field` is the
 * dot-separated path to the property (e.g. `items.0.name` for arrays/nested DTOs).
 * Clients should branch on `rule`, never on `message`, which is human-readable
 * and may be localized.
 */
export interface ValidationViolation {
  field: string;
  rule: string;
  message: string;
}

/** Flattens `class-validator` errors into one `ValidationViolation` per failed rule, including nested DTOs and array items. */
export function flattenValidationViolations(
  errors: ValidationError[],
  parentPath = '',
): ValidationViolation[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = Object.entries(error.constraints || {}).map(([rule, message]) => ({ field, rule, message }));
    return [...own, ...flattenValidationViolations(error.children || [], field)];
  });
}
