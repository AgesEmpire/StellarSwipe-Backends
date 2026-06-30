/**
 * Commitlint configuration.
 *
 * Enforces the Conventional Commits specification so that the commit history is
 * machine-parseable for changelog generation and history scanning.
 *
 * Format:  <type>(<optional scope>): <subject>
 * Example: feat(trades): add bulkhead isolation for Horizon calls
 *
 * @see https://www.conventionalcommits.org/
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allowed commit types.
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // Keep the header readable.
    'header-max-length': [2, 'always', 100],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
  },
};
