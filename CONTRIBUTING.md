# Contributing

Thanks for contributing to StellarSwipe Backend! This guide covers local setup
and the commit conventions enforced by our tooling.

## Getting started

```bash
npm install
```

`npm install` runs the `prepare` script, which installs the [Husky](https://typicode.github.io/husky/)
git hooks automatically. No manual hook setup is required.

## Commit message format

Commit messages **must** follow the
[Conventional Commits](https://www.conventionalcommits.org/) specification. This
is enforced locally by a Husky `commit-msg` hook running
[commitlint](https://commitlint.js.org/) — commits that don't conform are
rejected before they land.

```
<type>(<optional scope>): <subject>

<optional body>

<optional footer(s)>
```

### Allowed types

| Type       | Use for                                                        |
| ---------- | -------------------------------------------------------------- |
| `feat`     | A new feature                                                  |
| `fix`      | A bug fix                                                      |
| `docs`     | Documentation-only changes                                     |
| `style`    | Formatting, whitespace, etc. (no logic change)                 |
| `refactor` | Code change that neither fixes a bug nor adds a feature        |
| `perf`     | A performance improvement                                      |
| `test`     | Adding or fixing tests                                         |
| `build`    | Build system or external dependency changes                   |
| `ci`       | CI configuration changes                                       |
| `chore`    | Routine tasks, tooling, maintenance                            |
| `revert`   | Reverts a previous commit                                      |

### Examples

```
feat(trades): add bulkhead isolation for Horizon API calls
fix(auth): reject expired sessions on refresh
docs: document conventional commit format
refactor(wallet): extract authenticated wallet via @CurrentWallet decorator
chore(deps): bump @stellar/stellar-sdk to 12.3.0
```

Rules of thumb:

- Keep the header (`type(scope): subject`) to **100 characters or less**.
- Use the imperative mood in the subject ("add", not "added"/"adds").
- Don't end the subject with a period.
- Reference issues in the footer, e.g. `Closes #123`.

## Git hooks

| Hook         | Runs                                              |
| ------------ | ------------------------------------------------- |
| `commit-msg` | `commitlint` — validates the commit message       |
| `pre-push`   | `npm run lint` and `npm run test:smoke`           |

To bypass hooks in an emergency you can pass `--no-verify` to `git commit` /
`git push`, but please don't make a habit of it.
