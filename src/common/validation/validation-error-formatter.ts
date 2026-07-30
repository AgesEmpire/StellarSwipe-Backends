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
