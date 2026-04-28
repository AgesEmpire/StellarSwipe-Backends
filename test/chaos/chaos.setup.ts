/**
 * Global setup for all chaos tests.
 *
 * - Longer timeout than regular unit tests.
 * - Console output is NOT suppressed so resilience metrics are printed.
 * - Restores real timers after each test to avoid leaking fake-timer state.
 */

process.env.NODE_ENV = 'test';

// Chaos tests print metrics to stdout deliberately — do not suppress console
// (contrast with test/setup.ts which silences console for unit tests)

jest.setTimeout(60_000);

afterEach(() => {
  // Guarantee real timers are restored even if a test forgets to do it
  jest.useRealTimers();
});
