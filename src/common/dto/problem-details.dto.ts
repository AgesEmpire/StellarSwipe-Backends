/**
 * RFC 7807 "Problem Details for HTTP APIs" response shape.
 * @see https://www.rfc-editor.org/rfc/rfc7807
 */
export interface FieldValidationError {
  field: string;
  messages: string[];
}

export class ProblemDetailsDto {
  /** URI reference identifying the problem type, e.g. "urn:stellarswipe:problem:V1001". */
  type: string;
  /** Short, human-readable summary of the problem type. */
  title: string;
  /** HTTP status code for this occurrence. */
  status: number;
  /** Human-readable explanation specific to this occurrence. Never contains stack traces. */
  detail: string;
  /** URI reference identifying the specific occurrence — the request path. */
  instance: string;
  /** Timestamp the problem was generated. */
  timestamp: string;
  /** Correlation ID for tracing this request across services and logs. */
  correlationId?: string;
  /** Machine-readable error code from the canonical error registry. */
  errorCode: string;
  /** Field-level validation failures, present only for validation problems. */
  errors?: FieldValidationError[];
}
