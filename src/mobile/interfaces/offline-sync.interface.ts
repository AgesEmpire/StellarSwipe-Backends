export interface OfflineSyncManifest {
  lastSyncAt: string; // ISO timestamp
  version: number;
  resources: OfflineSyncResource[];
}

export interface OfflineSyncResource {
  type: 'signals' | 'portfolio' | 'prices';
  etag: string;
  expiresAt: string;
  url: string;
}

export interface DeltaSyncResult<T> {
  added: T[];
  updated: T[];
  deletedIds: string[];
  syncedAt: string;
  nextSyncToken: string;
}
