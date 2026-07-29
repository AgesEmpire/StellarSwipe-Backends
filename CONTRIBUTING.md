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

## Architecture Decision Records (ADRs)

When your PR modifies architecturally-significant code paths (GraphQL API, authentication, external integrations, etc.), you must create or reference an ADR documenting the decision.

### What requires an ADR?

An ADR is required for changes affecting:

- Data layer (database schema, ORM patterns, migrations)
- API layer (GraphQL schema design, REST endpoints, error handling)
- External integrations (Stellar Horizon, Soroban RPC, third-party services)
- Security (authentication, authorization, secrets management)
- Performance (caching, N+1 prevention, optimization strategies)
- System architecture (module structure, service boundaries, patterns)

### How to create or reference an ADR

1. **Create a new ADR:**
   ```bash
   cp docs/adr/0000-template.md docs/adr/NNNN-your-title.md
   ```
   Use the next sequential number and write the ADR following the template.

2. **Reference an existing ADR:**
   Mention the ADR number in your PR description or commit message:
   ```
   Closes #123

   Implements ADR-0002 (DataLoader batching strategy)
   ```

3. **Request exemption (if ADR doesn't apply):**
   Add the `adr-exemption` label to your PR and document your justification in the description.

### Resources

- [ADR Template](./docs/adr/0000-template.md)
- [ADR Process Guide](./docs/adr/README.md)
- [Existing ADRs](./docs/adr/)
