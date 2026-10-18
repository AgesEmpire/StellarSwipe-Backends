import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { restoreOrThrow, softDeleteOrThrow } from './soft-delete.helper';

describe('soft-delete.helper', () => {
  function buildMockRepo(entity: any) {
    return {
      findOne: jest.fn().mockResolvedValue(entity),
      restore: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
      metadata: { name: 'TestEntity' },
    } as unknown as Repository<any>;
  }

  describe('softDeleteOrThrow', () => {
    it('throws NotFoundException when the record does not exist', async () => {
      const repo = buildMockRepo(null);
      await expect(softDeleteOrThrow(repo, 'id-1')).rejects.toThrow(NotFoundException);
    });

    it('soft-deletes an existing record', async () => {
      const repo = buildMockRepo({ id: 'id-1', deletedAt: null });
      await softDeleteOrThrow(repo, 'id-1');
      expect(repo.softDelete).toHaveBeenCalledWith('id-1');
    });
  });

  describe('restoreOrThrow', () => {
    it('throws NotFoundException when the record does not exist', async () => {
      const repo = buildMockRepo(null);
      await expect(restoreOrThrow(repo, 'id-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the record was never deleted', async () => {
      const repo = buildMockRepo({ id: 'id-1', deletedAt: null });
      await expect(restoreOrThrow(repo, 'id-1')).rejects.toThrow(ConflictException);
    });

    it('restores without an authorization check when no roles are configured', async () => {
      const repo = buildMockRepo({ id: 'id-1', deletedAt: new Date() });
      await restoreOrThrow(repo, 'id-1');
      expect(repo.restore).toHaveBeenCalledWith('id-1');
    });

    it('throws ForbiddenException when the actor lacks an allowed role', async () => {
      const repo = buildMockRepo({ id: 'id-1', deletedAt: new Date() });
      await expect(
        restoreOrThrow(repo, 'id-1', {
          actorRoles: ['viewer'],
          allowedRoles: ['admin', 'trader'],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it('restores when the actor holds an allowed role', async () => {
      const repo = buildMockRepo({ id: 'id-1', deletedAt: new Date() });
      await restoreOrThrow(repo, 'id-1', {
        actorRoles: ['trader'],
        allowedRoles: ['admin', 'trader'],
      });
      expect(repo.restore).toHaveBeenCalledWith('id-1');
    });

    it('throws ConflictException when conflictCheck reports a conflict', async () => {
      const repo = buildMockRepo({ id: 'id-1', deletedAt: new Date() });
      await expect(
        restoreOrThrow(repo, 'id-1', {
          conflictCheck: () => 'a replacement record already exists',
        }),
      ).rejects.toThrow(ConflictException);
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it('restores when conflictCheck reports no conflict', async () => {
      const repo = buildMockRepo({ id: 'id-1', deletedAt: new Date() });
      await restoreOrThrow(repo, 'id-1', {
        conflictCheck: async () => null,
      });
      expect(repo.restore).toHaveBeenCalledWith('id-1');
    });

    it('invokes onRestored with a history entry after a successful restore', async () => {
      const repo = buildMockRepo({ id: 'id-1', deletedAt: new Date() });
      const onRestored = jest.fn();
      await restoreOrThrow(repo, 'id-1', {
        actorRoles: ['admin'],
        onRestored,
      });
      expect(onRestored).toHaveBeenCalledWith(
        expect.objectContaining({
          entityName: 'TestEntity',
          entityId: 'id-1',
          restoredByRoles: ['admin'],
          restoredAt: expect.any(Date),
        }),
      );
    });

    it('accepts a plain string as a legacy notFoundMessage argument', async () => {
      const repo = buildMockRepo(null);
      await expect(restoreOrThrow(repo, 'id-1', 'Custom not found message')).rejects.toThrow(
        'Custom not found message',
      );
    });
  });
});
