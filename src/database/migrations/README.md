# Database Migrations

This directory contains TypeORM migrations for the StellarSwipe database schema.

## Running Migrations

```bash
# Generate a new migration
npm run typeorm migration:generate -- -n MigrationName

# Run pending migrations
npm run typeorm migration:run

# Revert the last migration
npm run typeorm migration:revert
```

## Migration Files

- `1737561600000-CreateUserTables.ts` – Initial user schema with users, user_preferences, and sessions tables

## Migration Rollback Safety (`migration-utils.ts`)

`migration-utils.ts` provides helpers that improve rollback safety and surface
irreversible changes **before** they are applied to the database.

### `detectIrreversibleChanges(sql)`

Analyses a SQL string (or array of strings) for operations that cannot be
safely rolled back. Returns an `IrreversibilityReport` with all findings
sorted by severity (`CRITICAL → HIGH → WARNING`).

```ts
import { detectIrreversibleChanges } from './migration-utils';

const report = detectIrreversibleChanges('DROP TABLE legacy_tokens');
if (report.hasIrreversibleChanges) {
  console.warn(report.changes); // [{ rule: 'DROP_TABLE', severity: 'CRITICAL', … }]
}
```

**Detected patterns**

| Rule               | Severity | Description                                              |
|--------------------|----------|----------------------------------------------------------|
| `DROP_TABLE`       | CRITICAL | Permanently removes table and data                       |
| `DROP_COLUMN`      | CRITICAL | Permanently removes column and stored values             |
| `DROP_DATABASE`    | CRITICAL | Destroys the entire database                             |
| `DROP_SCHEMA`      | CRITICAL | Removes schema and all contained objects                 |
| `TRUNCATE`         | CRITICAL | Removes all rows without row-level logging               |
| `DROP_TYPE`        | HIGH     | Removes a custom type; dependent columns must be migrated|
| `DROP_CONSTRAINT`  | HIGH     | Existing data may violate constraint on re-add           |
| `ALTER_COLUMN_TYPE`| HIGH     | Narrowing a type may cause data loss                     |
| `DELETE_DATA`      | HIGH     | Permanently removes rows                                 |
| `DROP_INDEX`       | WARNING  | Performance impact if `down()` does not recreate it      |
| `SET_NOT_NULL`     | WARNING  | Fails if existing rows contain NULL                      |
| `UPDATE_DATA`      | WARNING  | Original values lost unless `down()` reverses the change |

---

### `withRollbackSafety(queryRunner, sql, body, options?)`

Wraps a migration `up()` body with:

1. Pre-flight irreversibility analysis (logs findings).
2. Optional blocking on `CRITICAL` or `HIGH` findings.
3. Savepoint-based partial-failure recovery.

```ts
import { withRollbackSafety } from './migration-utils';

public async up(queryRunner: QueryRunner): Promise<void> {
  await withRollbackSafety(
    queryRunner,
    'DROP TABLE legacy_tokens',
    async () => {
      await queryRunner.query('DROP TABLE legacy_tokens');
    },
    { blockOnCritical: true }, // throws MigrationRollbackError if CRITICAL found
  );
}
```

**Options**

| Option           | Type      | Default | Description                                      |
|------------------|-----------|---------|--------------------------------------------------|
| `blockOnCritical`| `boolean` | `false` | Throw before executing if CRITICAL changes found |
| `blockOnHigh`    | `boolean` | `false` | Throw before executing if HIGH changes found     |
| `logger`         | `Console` | `console`| Custom logger for findings                      |

---

### Data-level backup helpers

Use these when a migration modifies or removes data and you need a safety net
that can be used in `down()`.

```ts
import { createSafeBackup, restoreFromBackup, dropBackupTable } from './migration-utils';

// In up():
const backupTable = await createSafeBackup(queryRunner, 'users');
// … destructive operation …

// In down():
await restoreFromBackup(queryRunner, 'users', backupTable);
// Once confirmed stable:
await dropBackupTable(queryRunner, backupTable);
```

---

### Existence guards

Use these in `down()` to prevent errors on double-rollback.

```ts
import { tableExists, columnExists } from './migration-utils';

public async down(queryRunner: QueryRunner): Promise<void> {
  if (await tableExists(queryRunner, 'legacy_tokens')) {
    await queryRunner.dropTable('legacy_tokens');
  }
  if (await columnExists(queryRunner, 'users', 'referred_by')) {
    await queryRunner.dropColumn('users', 'referred_by');
  }
}
```
