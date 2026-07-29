import { Injectable } from '@nestjs/common';
import { DeltaSyncResult } from '../interfaces/offline-sync.interface';

@Injectable()
export class DeltaSyncService {
  /**
   * Computes delta between a client sync token (timestamp) and current data.
   * In production, replace with DB query filtered by updatedAt > lastSync.
   */
  computeDelta<T extends { id: string; updatedAt: Date; deletedAt?: Date | null }>(
    items: T[],
    syncToken: string | undefined,
  ): DeltaSyncResult<T> {
    const lastSync = syncToken ? new Date(syncToken) : new Date(0);
    const added: T[] = [];
    const updated: T[] = [];
    const deletedIds: string[] = [];

    for (const item of items) {
      if (item.deletedAt) {
        deletedIds.push(item.id);
        continue;
      }
      if (item.updatedAt > lastSync) {
        const isNew = item.updatedAt.getTime() === (item as Record<string, unknown>)['createdAt']
          ? true
          : item.updatedAt > lastSync;
        isNew ? added.push(item) : updated.push(item);
      }
    }

    const syncedAt = new Date().toISOString();
    return { added, updated, deletedIds, syncedAt, nextSyncToken: syncedAt };
  }
}
