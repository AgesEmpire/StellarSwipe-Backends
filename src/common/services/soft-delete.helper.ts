import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

type SoftDeletable = { id: string; deletedAt?: Date | null };

/**
 * Soft-deletes an entity by id, throwing if it doesn't exist (or is already deleted).
 * Reusable across services whose entity uses TypeORM's @DeleteDateColumn.
 */
export async function softDeleteOrThrow<T extends SoftDeletable>(
  repository: Repository<T>,
  id: string,
  notFoundMessage = 'Record not found',
): Promise<void> {
  const entity = await repository.findOne({ where: { id } as any });
  if (!entity) {
    throw new NotFoundException(notFoundMessage);
  }
  await repository.softDelete(id);
}

/** A single recorded restore, handed to `onRestored` for history/audit purposes. */
export interface RestoreHistoryEntry {
  entityName: string;
  entityId: string;
  restoredAt: Date;
  restoredByRoles: string[];
}

export interface RestoreOptions<T extends SoftDeletable> {
  /** Message used when the record cannot be found (or was never soft-deleted). */
  notFoundMessage?: string;
  /**
   * Roles held by the actor performing the restore. Required (together with
   * `allowedRoles`) to enforce restore authorization; omit both to skip the
   * authorization check entirely (e.g. for internal/system callers).
   */
  actorRoles?: string[];
  /** Roles permitted to restore this record. The actor must hold at least one. */
  allowedRoles?: string[];
  /**
   * Called with the soft-deleted entity before it is restored. Return a
   * non-empty reason string to reject the restore with a 409 Conflict (e.g.
   * because a replacement record already exists, or retained/purged data
   * would be contradicted by the restore).
   */
  conflictCheck?: (entity: T) => Promise<string | null | undefined> | string | null | undefined;
  /** Called after a successful restore; use it to persist restore history/audit trail. */
  onRestored?: (entry: RestoreHistoryEntry) => void | Promise<void>;
}

/**
 * Restores a previously soft-deleted entity by id.
 *
 * Throws:
 * - `NotFoundException` if the record doesn't exist or was never deleted.
 * - `ForbiddenException` if `allowedRoles` is set and the actor holds none of them.
 * - `ConflictException` if `conflictCheck` reports a conflict (e.g. a
 *   replacement record already exists, or restoring would contradict
 *   already-retained/purged data).
 *
 * For backwards compatibility, the third argument may also be passed as a
 * plain string, which is treated as `notFoundMessage`.
 */
export async function restoreOrThrow<T extends SoftDeletable>(
  repository: Repository<T>,
  id: string,
  options: RestoreOptions<T> | string = {},
): Promise<T> {
  const opts: RestoreOptions<T> = typeof options === 'string' ? { notFoundMessage: options } : options;
  const notFoundMessage = opts.notFoundMessage ?? 'Record not found';

  const entity = await repository.findOne({
    where: { id } as any,
    withDeleted: true,
  });
  if (!entity) {
    throw new NotFoundException(notFoundMessage);
  }
  if (!entity.deletedAt) {
    throw new ConflictException('Record is not deleted');
  }

  if (opts.allowedRoles && opts.allowedRoles.length > 0) {
    const actorRoles = opts.actorRoles ?? [];
    const isAuthorized = actorRoles.some((role) => opts.allowedRoles!.includes(role));
    if (!isAuthorized) {
      throw new ForbiddenException(
        `Restoring this record requires one of the following roles: ${opts.allowedRoles.join(', ')}`,
      );
    }
  }

  if (opts.conflictCheck) {
    const conflictReason = await opts.conflictCheck(entity);
    if (conflictReason) {
      throw new ConflictException(conflictReason);
    }
  }

  await repository.restore(id);

  if (opts.onRestored) {
    await opts.onRestored({
      entityName: repository.metadata?.name ?? 'unknown',
      entityId: id,
      restoredAt: new Date(),
      restoredByRoles: opts.actorRoles ?? [],
    });
  }

  return entity;
}
