# Advisory Locking for Migrations & Maintenance Jobs

## Why

During a deployment window, multiple processes can end up racing to run the
same critical operation:

- Two replicas of the API boot at once and both try to run pending migrations.
- A scheduled maintenance job (e.g. backup cleanup) fires while a deploy is
  also running migrations against the same database.
- A manual `npm run migration:run` is triggered while the app is mid-deploy.

Without coordination this can corrupt schema state, double-run destructive
cleanup, or produce confusing partial failures. `AdvisoryLockService`
(`src/common/database/advisory-lock.service.ts`) wraps Postgres session-level
advisory locks (`pg_try_advisory_lock` / `pg_advisory_unlock`) so only one
process can hold a named lock at a time — enforced by Postgres itself, not
application state, so it works correctly across replicas and CLI invocations.

## Usage

```ts
import { AdvisoryLockService } from '../common/database/advisory-lock.service';

@Injectable()
class MyMaintenanceJob {
  constructor(private readonly locks: AdvisoryLockService) {}

  async run() {
    // Throws LockAcquisitionException (HTTP 409) if not acquired within timeoutMs.
    return this.locks.runExclusive(
      'maintenance:my-job',
      async () => {
        // critical section
      },
      { timeoutMs: 30_000, pollIntervalMs: 250 },
    );
  }
}
```

If a job should silently skip (rather than fail loudly) when another instance
already holds the lock — e.g. a cron job that's fine running on just one
replica — catch `LockAcquisitionException` around the call, as done in
`BackupCleanupJob`.

## Where it's wired in

- `MigrationService.runMigrations` / `revertMigration` — lock name
  `stellarswipe:migrations`.
- `BackupCleanupJob` — lock name `stellarswipe:maintenance:backup-cleanup`,
  skips (does not fail the deploy) if another instance is already cleaning up.

## Operational notes for safe deployment

1. **Lock names are global to the database**, not per-replica. Use a stable,
   descriptive name (`stellarswipe:<domain>:<job>`) so unrelated jobs never
   collide and related ones always do.
2. **Locks are held per Postgres session**, not per transaction — if the
   connection used to acquire the lock is dropped (pool eviction, connection
   reset), Postgres releases the lock automatically. This is a feature: a
   crashed process can't leave a stale lock behind forever.
3. **Timeouts matter.** `runExclusive` polls rather than blocking the DB
   connection, so pick a `timeoutMs` that reflects how long it's acceptable to
   wait — migrations during a deploy should fail fast (seconds), while a
   nightly cleanup job can afford to simply skip its run.
4. **Observability**: acquisition/release/timeout are logged at `debug`/`log`/
   `warn` respectively. Check `pg_locks` joined against `pg_stat_activity` in
   Postgres directly if a lock appears stuck longer than expected.
5. **Never bypass the lock** by calling `dataSource.runMigrations()` directly
   in new code paths — always go through `MigrationService` so the lock is
   consistently enforced.
