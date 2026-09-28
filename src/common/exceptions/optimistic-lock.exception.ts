import { ConflictException } from '@nestjs/common';

/**
 * Thrown when an update targets a row whose version no longer matches the
 * version the caller last read — i.e. another request modified it first.
 */
export class OptimisticLockException extends ConflictException {
  constructor(entityName: string, id: string) {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: 'OPTIMISTIC_LOCK_CONFLICT',
      message: `${entityName} ${id} was modified by another request. Refetch the latest version and retry.`,
    });
  }
}
