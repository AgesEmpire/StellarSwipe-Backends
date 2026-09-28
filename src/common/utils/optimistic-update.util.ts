import { NotFoundException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { OptimisticLockException } from '../exceptions/optimistic-lock.exception';

/**
 * Applies `changes` to the row identified by `id`, but only if its current
 * `version` still equals `expectedVersion`. The version column is bumped
 * atomically as part of the same UPDATE statement.
 *
 * Guards against lost updates when two requests read the same row and then
 * both write back stale data — the second writer gets a clear 409 instead of
 * silently overwriting the first writer's change.
 */
export async function updateWithVersionCheck<T extends ObjectLiteral & { id: string; version: number }>(
  repository: Repository<T>,
  entityName: string,
  id: string,
  expectedVersion: number,
  changes: Partial<T>,
): Promise<void> {
  const result = await repository
    .createQueryBuilder()
    .update(repository.target)
    .set({
      ...(changes as ObjectLiteral),
      version: () => '"version" + 1',
    } as any)
    .where('id = :id', { id })
    .andWhere('version = :expectedVersion', { expectedVersion })
    .execute();

  if (result.affected && result.affected > 0) {
    return;
  }

  const stillExistsCount = await repository.count({ where: { id } as any });
  if (stillExistsCount === 0) {
    throw new NotFoundException(`${entityName} ${id} not found`);
  }
  throw new OptimisticLockException(entityName, id);
}
