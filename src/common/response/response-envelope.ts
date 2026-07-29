export interface SuccessResponseEnvelope<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  timestamp: string;
}

export interface ErrorResponseEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export type ResponseEnvelope<T = unknown> =
  | SuccessResponseEnvelope<T>
  | ErrorResponseEnvelope;

export function successEnvelope<T>(
  data: T,
  meta?: Record<string, unknown>,
): SuccessResponseEnvelope<T> {
  return {
    success: true,
    data,
    ...(meta ? { meta } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorResponseEnvelope {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    timestamp: new Date().toISOString(),
  };
}
