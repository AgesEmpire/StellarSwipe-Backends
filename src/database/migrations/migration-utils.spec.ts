import {
  detectIrreversibleChanges,
  withRollbackSafety,
  createSafeBackup,
  restoreFromBackup,
  dropBackupTable,
  tableExists,
  columnExists,
  IrreversibleSeverity,
  MigrationRollbackError,
} from './migration-utils';

// ---------------------------------------------------------------------------
// Shared mock QueryRunner
// ---------------------------------------------------------------------------

function buildQueryRunner(queryResults: Record<string, unknown> = {}) {
  return {
    query: jest.fn().mockImplementation((sql: string, _params?: unknown[]) => {
      // Return a custom result if registered, otherwise resolve to []
      for (const [key, value] of Object.entries(queryResults)) {
        if (sql.includes(key)) return Promise.resolve(value);
      }
      return Promise.resolve([]);
    }),
  };
}

// ---------------------------------------------------------------------------
// detectIrreversibleChanges
// ---------------------------------------------------------------------------

describe('detectIrreversibleChanges', () => {
  it('returns a clean report for safe SQL', () => {
    const report = detectIrreversibleChanges('CREATE TABLE foo (id uuid PRIMARY KEY)');
    expect(report.hasIrreversibleChanges).toBe(false);
    expect(report.changes).toHaveLength(0);
    expect(report.maxSeverity).toBeNull();
  });

  it('detects DROP TABLE as CRITICAL', () => {
    const report = detectIrreversibleChanges('DROP TABLE users');
    expect(report.hasIrreversibleChanges).toBe(true);
    const finding = report.changes.find((c) => c.rule === 'DROP_TABLE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.CRITICAL);
  });

  it('detects DROP COLUMN as CRITICAL', () => {
    const report = detectIrreversibleChanges(
      'ALTER TABLE users DROP COLUMN email',
    );
    const finding = report.changes.find((c) => c.rule === 'DROP_COLUMN');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.CRITICAL);
  });

  it('detects TRUNCATE as CRITICAL', () => {
    const report = detectIrreversibleChanges('TRUNCATE TABLE sessions');
    const finding = report.changes.find((c) => c.rule === 'TRUNCATE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.CRITICAL);
  });

  it('detects DROP TYPE as HIGH', () => {
    const report = detectIrreversibleChanges('DROP TYPE risk_level_enum');
    const finding = report.changes.find((c) => c.rule === 'DROP_TYPE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.HIGH);
  });

  it('detects DROP CONSTRAINT as HIGH', () => {
    const report = detectIrreversibleChanges(
      'ALTER TABLE users DROP CONSTRAINT uq_users_email',
    );
    const finding = report.changes.find((c) => c.rule === 'DROP_CONSTRAINT');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.HIGH);
  });

  it('detects ALTER COLUMN TYPE as HIGH', () => {
    const report = detectIrreversibleChanges(
      'ALTER TABLE users ALTER COLUMN score TYPE bigint',
    );
    const finding = report.changes.find((c) => c.rule === 'ALTER_COLUMN_TYPE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.HIGH);
  });

  it('detects DROP INDEX as WARNING', () => {
    const report = detectIrreversibleChanges('DROP INDEX idx_users_email');
    const finding = report.changes.find((c) => c.rule === 'DROP_INDEX');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.WARNING);
  });

  it('detects SET NOT NULL as WARNING', () => {
    const report = detectIrreversibleChanges(
      'ALTER TABLE users ALTER COLUMN email SET NOT NULL',
    );
    const finding = report.changes.find((c) => c.rule === 'SET_NOT_NULL');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.WARNING);
  });

  it('detects DELETE FROM as HIGH', () => {
    const report = detectIrreversibleChanges('DELETE FROM sessions WHERE expired = true');
    const finding = report.changes.find((c) => c.rule === 'DELETE_DATA');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.HIGH);
  });

  it('detects UPDATE … SET as WARNING', () => {
    const report = detectIrreversibleChanges("UPDATE users SET status = 'active'");
    const finding = report.changes.find((c) => c.rule === 'UPDATE_DATA');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(IrreversibleSeverity.WARNING);
  });

  it('accepts an array of SQL statements', () => {
    const report = detectIrreversibleChanges([
      'CREATE TABLE foo (id uuid PRIMARY KEY)',
      'DROP TABLE bar',
    ]);
    expect(report.hasIrreversibleChanges).toBe(true);
    expect(report.changes.find((c) => c.rule === 'DROP_TABLE')).toBeDefined();
  });

  it('sorts findings CRITICAL → HIGH → WARNING', () => {
    const report = detectIrreversibleChanges(
      "DROP INDEX idx_foo; DROP TABLE bar; UPDATE baz SET x = 1",
    );
    const severities = report.changes.map((c) => c.severity);
    const critIdx = severities.indexOf(IrreversibleSeverity.CRITICAL);
    const warnIdx = severities.indexOf(IrreversibleSeverity.WARNING);
    expect(critIdx).toBeLessThan(warnIdx);
  });

  it('sets maxSeverity to the highest finding', () => {
    const report = detectIrreversibleChanges('DROP INDEX idx_foo; DROP TABLE bar');
    expect(report.maxSeverity).toBe(IrreversibleSeverity.CRITICAL);
  });

  it('includes the matched SQL fragment in the finding', () => {
    const report = detectIrreversibleChanges('DROP TABLE users');
    expect(report.changes[0].fragment).toBeTruthy();
  });

  it('is case-insensitive', () => {
    const report = detectIrreversibleChanges('drop table users');
    expect(report.changes.find((c) => c.rule === 'DROP_TABLE')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// withRollbackSafety
// ---------------------------------------------------------------------------

describe('withRollbackSafety', () => {
  it('executes the body and releases the savepoint on success', async () => {
    const qr = buildQueryRunner();
    const body = jest.fn().mockResolvedValue(undefined);

    await withRollbackSafety(qr as any, 'CREATE TABLE foo (id uuid)', body);

    expect(body).toHaveBeenCalledTimes(1);
    const calls: string[] = qr.query.mock.calls.map((c: string[]) => c[0]);
    expect(calls.some((s) => s.startsWith('SAVEPOINT'))).toBe(true);
    expect(calls.some((s) => s.startsWith('RELEASE SAVEPOINT'))).toBe(true);
  });

  it('rolls back to savepoint and re-throws when body throws', async () => {
    const qr = buildQueryRunner();
    const body = jest.fn().mockRejectedValue(new Error('query failed'));

    await expect(
      withRollbackSafety(qr as any, 'CREATE TABLE foo (id uuid)', body),
    ).rejects.toThrow('query failed');

    const calls: string[] = qr.query.mock.calls.map((c: string[]) => c[0]);
    expect(calls.some((s) => s.startsWith('ROLLBACK TO SAVEPOINT'))).toBe(true);
  });

  it('logs CRITICAL findings but does not block by default', async () => {
    const qr = buildQueryRunner();
    const body = jest.fn().mockResolvedValue(undefined);
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };

    await withRollbackSafety(qr as any, 'DROP TABLE users', body, { logger });

    expect(logger.error).toHaveBeenCalled();
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('throws MigrationRollbackError when blockOnCritical is true and CRITICAL found', async () => {
    const qr = buildQueryRunner();
    const body = jest.fn().mockResolvedValue(undefined);

    await expect(
      withRollbackSafety(qr as any, 'DROP TABLE users', body, {
        blockOnCritical: true,
      }),
    ).rejects.toThrow(MigrationRollbackError);

    expect(body).not.toHaveBeenCalled();
  });

  it('does NOT throw when blockOnCritical is true but SQL is safe', async () => {
    const qr = buildQueryRunner();
    const body = jest.fn().mockResolvedValue(undefined);

    await expect(
      withRollbackSafety(
        qr as any,
        'CREATE TABLE foo (id uuid PRIMARY KEY)',
        body,
        { blockOnCritical: true },
      ),
    ).resolves.toBeUndefined();

    expect(body).toHaveBeenCalledTimes(1);
  });

  it('throws MigrationRollbackError when blockOnHigh is true and HIGH found', async () => {
    const qr = buildQueryRunner();
    const body = jest.fn().mockResolvedValue(undefined);

    await expect(
      withRollbackSafety(qr as any, 'DROP TYPE my_enum', body, {
        blockOnHigh: true,
      }),
    ).rejects.toThrow(MigrationRollbackError);

    expect(body).not.toHaveBeenCalled();
  });

  it('does NOT throw when blockOnHigh is true but only WARNING found', async () => {
    const qr = buildQueryRunner();
    const body = jest.fn().mockResolvedValue(undefined);

    await withRollbackSafety(qr as any, 'DROP INDEX idx_foo', body, {
      blockOnHigh: true,
    });

    expect(body).toHaveBeenCalledTimes(1);
  });

  it('MigrationRollbackError carries the full report', async () => {
    const qr = buildQueryRunner();
    const body = jest.fn();

    let caught: MigrationRollbackError | undefined;
    try {
      await withRollbackSafety(qr as any, 'DROP TABLE users', body, {
        blockOnCritical: true,
      });
    } catch (e) {
      caught = e as MigrationRollbackError;
    }

    expect(caught).toBeInstanceOf(MigrationRollbackError);
    expect(caught!.report.hasIrreversibleChanges).toBe(true);
    expect(caught!.report.maxSeverity).toBe(IrreversibleSeverity.CRITICAL);
  });
});

// ---------------------------------------------------------------------------
// createSafeBackup / restoreFromBackup / dropBackupTable
// ---------------------------------------------------------------------------

describe('createSafeBackup', () => {
  it('creates a backup table with the correct naming pattern', async () => {
    const qr = buildQueryRunner();
    const backupName = await createSafeBackup(qr as any, 'users');

    expect(backupName).toMatch(/^users_backup_\d+$/);
    expect(qr.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE'),
    );
  });
});

describe('restoreFromBackup', () => {
  it('truncates the target table and inserts from backup', async () => {
    const qr = buildQueryRunner();
    await restoreFromBackup(qr as any, 'users', 'users_backup_123');

    const calls: string[] = qr.query.mock.calls.map((c: string[]) => c[0]);
    expect(calls.some((s) => s.includes('TRUNCATE'))).toBe(true);
    expect(calls.some((s) => s.includes('INSERT INTO'))).toBe(true);
  });
});

describe('dropBackupTable', () => {
  it('issues DROP TABLE IF EXISTS for the backup table', async () => {
    const qr = buildQueryRunner();
    await dropBackupTable(qr as any, 'users_backup_123');

    expect(qr.query).toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE IF EXISTS'),
    );
  });
});

// ---------------------------------------------------------------------------
// tableExists / columnExists
// ---------------------------------------------------------------------------

describe('tableExists', () => {
  it('returns true when the table exists', async () => {
    const qr = buildQueryRunner({
      information_schema: [{ exists: true }],
    });
    const result = await tableExists(qr as any, 'users');
    expect(result).toBe(true);
  });

  it('returns false when the table does not exist', async () => {
    const qr = buildQueryRunner({
      information_schema: [{ exists: false }],
    });
    const result = await tableExists(qr as any, 'nonexistent');
    expect(result).toBe(false);
  });
});

describe('columnExists', () => {
  it('returns true when the column exists', async () => {
    const qr = buildQueryRunner({
      information_schema: [{ exists: true }],
    });
    const result = await columnExists(qr as any, 'users', 'email');
    expect(result).toBe(true);
  });

  it('returns false when the column does not exist', async () => {
    const qr = buildQueryRunner({
      information_schema: [{ exists: false }],
    });
    const result = await columnExists(qr as any, 'users', 'nonexistent_col');
    expect(result).toBe(false);
  });
});
