import type { Config } from '@stryker-mutator/api/config';

const config: Config = {
  // ── Mutation scope ────────────────────────────────────────────────────────
  // Scoped to trade execution orchestrator and risk-gate to keep runs fast
  // and focus mutation testing where correctness matters most.
  mutate: [
    'src/trades/services/trade-execution-orchestrator.service.ts',
    'src/risk/risk-gate/risk-gate.service.ts',
    'src/common/logger/log-redaction.ts',
  ],

  // ── Runner / checker ──────────────────────────────────────────────────────
  testRunner: 'jest',
  jest: {
    // Re-use the project's own Jest config so coverage and transform rules
    // are consistent. Stryker overrides testMatch internally.
    configFile: 'jest.config.js',
    enableFindRelatedTests: true,
  },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',

  // ── Reporters ─────────────────────────────────────────────────────────────
  reporters: ['html', 'clear-text', 'progress', 'json'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },

  // ── Thresholds ────────────────────────────────────────────────────────────
  // A baseline of 60 is intentionally conservative for the first run;
  // tighten after surviving mutants are addressed.
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },

  // ── Performance ───────────────────────────────────────────────────────────
  concurrency: 2,
  timeoutMS: 10_000,
  timeoutFactor: 1.5,

  // ── Ignores ───────────────────────────────────────────────────────────────
  // Exclude logger noise, type assertions, and explicit coverage-ignore blocks.
  ignorePatterns: [
    'node_modules',
    'dist',
    'reports',
    'coverage',
    'src/migrations',
  ],
  ignoreStatic: true,
};

export default config;
