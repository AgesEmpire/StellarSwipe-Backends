import { ConflictException } from '@nestjs/common';

/** Stable error code returned in the response body for advisory lock contention. */
export const LOCK_ACQUISITION_ERROR_CODE = 'LOCK_ACQUISITION_FAILED';

/**
 * Thrown by {@link AdvisoryLockService} when a caller requires a Postgres
 * advisory lock and another session already holds it — most commonly during
 * deployment windows where a migration and a scheduled maintenance job
 * (or two replicas of the same job) race for the same resource.
 *
 * Always resolves to HTTP 409 with a machine-readable `code` so operators and
 * deploy scripts can distinguish "another operation is in progress" from a
 * generic conflict.
 */
export class LockAcquisitionException extends ConflictException {
  constructor(
    public readonly lockName: string,
    message: string = `Could not acquire advisory lock "${lockName}" — another maintenance operation is in progress.`,
  ) {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: LOCK_ACQUISITION_ERROR_CODE,
      lockName,
      message,
    });
  }
}
