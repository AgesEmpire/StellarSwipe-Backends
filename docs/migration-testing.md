# Migration Testing Workflow

This document describes how migration and rollback paths are validated
before schema changes reach production.

## What is covered

`test/migrations/migration-rollback.spec.ts` spins up an in-memory
sqlite `DataSource`, then:

1. Applies every migration in `src/database/migrations`.
2. Confirms no migrations remain pending after the run.
3. Reverts the most recently applied migration and asserts the `down()`
   method executes without error.

This catches two common failure modes: migrations that don't apply
cleanly to a fresh schema, and `down()` methods that were never
exercised and silently drifted from their `up()` counterpart.

## Running locally

```bash
npx jest test/migrations/migration-rollback.spec.ts
```

## Running in CI

Include the same path in the existing Jest run (`jest.config.js`
already picks up files under `test/`), so no separate CI step is
required — the migration spec runs alongside the rest of the suite.

## Adding a new migration

When adding a migration under `src/database/migrations`, make sure it:

- Implements both `up()` and `down()`.
- Is idempotent when re-run against an already-migrated schema.
- Passes the rollback spec above locally before opening a PR.
