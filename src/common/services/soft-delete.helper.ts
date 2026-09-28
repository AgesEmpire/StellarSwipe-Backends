import { ConflictException, NotFoundException } from '@nestjs/common';
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

/**
 * Restores a previously soft-deleted entity by id, throwing if it doesn't exist
 * or was never deleted.
 */
export async function restoreOrThrow<T extends SoftDeletable>(
  repository: Repository<T>,
  id: string,
  notFoundMessage = 'Record not found',
): Promise<void> {
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
  await repository.restore(id);
}
