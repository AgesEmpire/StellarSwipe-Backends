import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * A single credential entry held by the store. The value is never logged or
 * exposed through observability hooks; only metadata is emitted.
 */
export interface CredentialEntry {
  /** Logical name of the credential, e.g. "stripe.apiKey". */
  name: string;
  /** Opaque secret value. Never logged. */
  value: string;
  /** Monotonic version assigned on each successful rotation. */
  version: number;
  /** Epoch millis when this version became active. */
  activatedAt: number;
  /** Epoch millis after which this version must no longer be used. */
  expiresAt: number;
}

/**
 * Metadata describing a rotation. Contains no secret material so it is safe to
 * emit to logs, metrics, or telemetry sinks.
 */
export interface RotationEvent {
  name: string;
  previousVersion: number;
  newVersion: number;
  rotatedAt: number;
  /** Bounded overlap window (ms) during which the previous value stays valid. */
  overlapMs: number;
}

export type RotationListener = (event: RotationEvent) => void;

/**
 * Raised when a rotation is attempted with an invalid payload. The message
 * never includes the offending value.
 */
export class CredentialRotationError extends Error {
  constructor(name: string, reason: string) {
    super(`Credential rotation failed for "${name}": ${reason}`);
    this.name = 'CredentialRotationError';
  }
}

/**
 * Default bounded overlap window. In-flight operations that captured the
 * previous credential may keep using it for this long after a rotation.
 */
export const DEFAULT_OVERLAP_MS = 30_000;

/**
 * Runtime credential store supporting atomic rotation without process
 * restarts.
 *
 * Guarantees:
 *  - Rotation is atomic: readers observe either the previous or the new
 *    version, never a partially applied state.
 *  - New operations immediately resolve the replacement credential.
 *  - In-flight operations may retain the previous credential for a bounded
 *    overlap window, after which it is evicted.
 *  - Rotation is observable via metadata-only events; secret values are never
 *    logged or emitted.
 */
@Injectable()
export class CredentialStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(CredentialStoreService.name);

  /** Active credential per name. Replaced atomically on rotation. */
  private readonly active = new Map<string, CredentialEntry>();

  /** Retired credentials kept alive for the bounded overlap window. */
  private readonly retired = new Map<string, CredentialEntry[]>();

  private readonly listeners = new Set<RotationListener>();

  private readonly overlapMs: number;

  private readonly sweepTimer?: NodeJS.Timeout;

  constructor(overlapMs: number = DEFAULT_OVERLAP_MS) {
    this.overlapMs = overlapMs > 0 ? overlapMs : DEFAULT_OVERLAP_MS;
    // Periodically evict retired credentials whose overlap window elapsed.
    this.sweepTimer = setInterval(() => this.sweepRetired(), Math.max(1_000, this.overlapMs));
    if (typeof this.sweepTimer.unref === 'function') {
      this.sweepTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    this.active.clear();
    this.retired.clear();
    this.listeners.clear();
  }

  /**
   * Register a credential. Used for initial load and for rotations. The
   * replacement becomes visible to new readers atomically.
   */
  set(name: string, value: string): CredentialEntry {
    if (!name) {
      throw new CredentialRotationError(String(name), 'credential name is required');
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new CredentialRotationError(name, 'credential value must be a non-empty string');
    }

    const now = Date.now();
    const previous = this.active.get(name);
    const entry: CredentialEntry = {
      name,
      value,
      version: previous ? previous.version + 1 : 1,
      activatedAt: now,
      expiresAt: now + this.overlapMs,
    };

    // Retire the previous version for the bounded overlap window before the
    // atomic swap so in-flight holders keep working.
    if (previous) {
      const bucket = this.retired.get(name) ?? [];
      bucket.push(previous);
      this.retired.set(name, bucket);
    }

    // Atomic replacement: a single map write flips all new readers to the
    // replacement credential.
    this.active.set(name, entry);

    if (previous) {
      this.emitRotation({
        name,
        previousVersion: previous.version,
        newVersion: entry.version,
        rotatedAt: now,
        overlapMs: this.overlapMs,
      });
    }

    return entry;
  }

  /**
   * Resolve the active credential value for a new operation. Throws if the
   * credential is unknown so callers fail fast rather than using stale data.
   */
  get(name: string): string {
    const entry = this.active.get(name);
    if (!entry) {
      throw new CredentialRotationError(name, 'credential is not registered');
    }
    return entry.value;
  }

  /**
   * Resolve the active credential entry (metadata + value) for a new
   * operation. Callers that need to pin a version for in-flight work should
   * capture the returned entry and pass it to {@link isUsable}.
   */
  getEntry(name: string): CredentialEntry {
    const entry = this.active.get(name);
    if (!entry) {
      throw new CredentialRotationError(name, 'credential is not registered');
    }
    return entry;
  }

  /**
   * Whether a previously captured entry may still be used. Returns true while
   * the entry is the active version or within its bounded overlap window.
   */
  isUsable(entry: CredentialEntry): boolean {
    const current = this.active.get(entry.name);
    if (current && current.version === entry.version) {
      return true;
    }
    if (Date.now() > entry.expiresAt) {
      return false;
    }
    const bucket = this.retired.get(entry.name);
    return !!bucket && bucket.some((candidate) => candidate.version === entry.version);
  }

  /**
   * Run an operation with the active credential, guaranteeing the credential
   * remains usable for the duration of the call. If a rotation occurs while
   * the operation is in flight, the captured version stays valid through the
   * bounded overlap window.
   */
  async withCredential<T>(name: string, fn: (value: string, entry: CredentialEntry) => Promise<T> | T): Promise<T> {
    const entry = this.getEntry(name);
    try {
      return await fn(entry.value, entry);
    } finally {
      // Nothing to release eagerly; the sweep evicts retired versions once the
      // overlap window elapses.
    }
  }

  /**
   * Subscribe to rotation events. Events carry metadata only and never expose
   * secret values.
   */
  onRotation(listener: RotationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Snapshot of credential metadata for observability. Contains no secret
   * values.
   */
  describe(): Array<Omit<CredentialEntry, 'value'>> {
    return Array.from(this.active.values()).map(({ value: _value, ...meta }) => meta);
  }

  private emitRotation(event: RotationEvent): void {
    // Metadata-only log line: no secret values are included.
    this.logger.log(
      `Credential rotated name=${event.name} previousVersion=${event.previousVersion} newVersion=${event.newVersion} overlapMs=${event.overlapMs}`,
    );
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.logger.warn(
          `Rotation listener failed for name=${event.name}: ${(err as Error)?.message ?? 'unknown error'}`,
        );
      }
    }
  }

  private sweepRetired(): void {
    const now = Date.now();
    for (const [name, bucket] of this.retired) {
      const remaining = bucket.filter((entry) => entry.expiresAt > now);
      if (remaining.length === 0) {
        this.retired.delete(name);
      } else {
        this.retired.set(name, remaining);
      }
    }
  }
}
