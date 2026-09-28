import { PermanentError } from '../common/retry';

/**
 * #1230 — Schema versioning for queued job payloads.
 *
 * Jobs can sit in Redis across deployments, so a worker may receive payloads
 * written by an older version of the app. Every payload carries a
 * `schemaVersion`; on read, older payloads are migrated step by step
 * (v1 → v2 → … → current) before a handler sees them. Payloads enqueued
 * before versioning existed have no `schemaVersion` and are treated as v1.
 *
 * A payload whose version is unknown (newer than this build, malformed, or
 * without a migration path) fails with `UnsupportedPayloadVersionError`. It
 * is a `PermanentError`, so it is dead-lettered instead of retried.
 */
export class UnsupportedPayloadVersionError extends PermanentError {
  constructor(
    public readonly schema: string,
    public readonly version: unknown,
  ) {
    super(
      `Unsupported ${schema} payload schemaVersion ${JSON.stringify(version)}`,
    );
    this.name = 'UnsupportedPayloadVersionError';
  }
}

export type PayloadMigration = (
  payload: Record<string, unknown>,
) => Record<string, unknown>;

export class VersionedPayloadSchema<T extends { schemaVersion: number }> {
  /**
   * @param name           Label used in errors and logs.
   * @param currentVersion Version written by this build.
   * @param migrations     `migrations[n]` upgrades a version-n payload to n + 1.
   */
  constructor(
    readonly name: string,
    readonly currentVersion: number,
    private readonly migrations: Record<number, PayloadMigration>,
  ) {}

  /** Returns `payload` in the current schema, migrating older versions. */
  upgrade(payload: unknown): T {
    if (!payload || typeof payload !== 'object') {
      throw new UnsupportedPayloadVersionError(this.name, undefined);
    }

    let data = payload as Record<string, unknown>;
    const version: unknown = data.schemaVersion ?? 1;
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > this.currentVersion
    ) {
      throw new UnsupportedPayloadVersionError(this.name, version);
    }

    for (let v = version; v < this.currentVersion; v++) {
      const migrate = this.migrations[v];
      if (!migrate) {
        throw new UnsupportedPayloadVersionError(this.name, v);
      }
      data = { ...migrate(data), schemaVersion: v + 1 };
    }
    return data as T;
  }
}
