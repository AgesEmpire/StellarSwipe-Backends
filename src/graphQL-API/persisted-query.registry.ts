import { createHash } from 'crypto';

/**
 * In-memory persisted-query registry.
 *
 * Production: only registered hashes are executable.
 * Development: arbitrary queries are allowed (escape hatch via NODE_ENV).
 *
 * Hash format: SHA-256 hex of the normalised query document string.
 */
export class PersistedQueryRegistry {
  private readonly store = new Map<string, string>();

  /** Register a query document and return its hash. */
  register(document: string): string {
    const hash = createHash('sha256').update(document.trim()).digest('hex');
    this.store.set(hash, document.trim());
    return hash;
  }

  /** Look up a document by hash. Returns undefined when not found. */
  lookup(hash: string): string | undefined {
    return this.store.get(hash);
  }

  has(hash: string): boolean {
    return this.store.has(hash);
  }

  get size(): number {
    return this.store.size;
  }
}

/** Singleton registry — shared across the application. */
export const persistedQueryRegistry = new PersistedQueryRegistry();
