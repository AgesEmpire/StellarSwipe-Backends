/**
 * Jest configuration for chaos / resilience tests.
 *
 * Kept separate from the main jest.config.js so chaos tests:
 *   - Do not run in the standard `npm test` / CI unit-test pipeline.
 *   - Have a longer timeout budget (failures + retries take more time).
 *   - Are run serially (--runInBand) to avoid port / resource contention.
 *
 * Usage:
 *   npx jest --config jest.chaos.config.js
 *   npx jest --config jest.chaos.config.js --testPathPattern=database
 *   npx jest --config jest.chaos.config.js --verbose
 */

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/chaos/.*\\.chaos\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  // Run serially — chaos tests mutate shared state (axios interceptors, mocks)
  runInBand: true,
  // Chaos tests involve intentional delays and retry loops
  testTimeout: 60_000,
  setupFilesAfterEnv: ['<rootDir>/test/chaos/chaos.setup.ts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^test/(.*)$': '<rootDir>/test/$1',
  },
  // Do not enforce coverage thresholds for chaos tests
  collectCoverage: false,
  verbose: true,
};
