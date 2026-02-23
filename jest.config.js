module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'src/providers/analytics/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/providers/analytics/**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
