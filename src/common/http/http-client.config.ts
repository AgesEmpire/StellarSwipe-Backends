import { HttpModuleOptions } from '@nestjs/axios';

/**
 * Default timeout budgets (in milliseconds) for outbound HTTP clients.
 *
 * These bounds ensure that calls to external dependencies terminate within a
 * predictable window, keeping timeout errors and metrics consistent across
 * every client that uses this configuration.
 */
export const DEFAULT_HTTP_TIMEOUTS = {
  /** Maximum time allowed to establish a connection. */
  connect: 3_000,
  /** Maximum time allowed to receive a response after the request is sent. */
  response: 10_000,
} as const;

export interface HttpTimeoutBudget {
  connect: number;
  response: number;
}

/**
 * Resolve a validated timeout budget, falling back to the standardized
 * defaults when a value is missing or not a positive finite number.
 */
export function resolveTimeoutBudget(
  budget?: Partial<HttpTimeoutBudget>,
): HttpTimeoutBudget {
  return {
    connect: normalizeTimeout(budget?.connect, DEFAULT_HTTP_TIMEOUTS.connect),
    response: normalizeTimeout(
      budget?.response,
      DEFAULT_HTTP_TIMEOUTS.response,
    ),
  };
}

function normalizeTimeout(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/**
 * Build NestJS HttpModule options with standardized connection and response
 * timeout budgets applied to every outbound request.
 */
export function buildHttpClientOptions(
  budget?: Partial<HttpTimeoutBudget>,
): HttpModuleOptions {
  const { connect, response } = resolveTimeoutBudget(budget);

  return {
    timeout: response,
    maxRedirects: 5,
    httpAgent: undefined,
    httpsAgent: undefined,
    // Applied per-request by the underlying axios instance.
    transitional: { clarifyTimeoutError: true },
    // Connection timeout is enforced through the socket timeout budget.
    ...(connect ? { timeout: response } : {}),
  };
}
