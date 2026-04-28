import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';

/** Emitted after a secret is successfully rotated. */
export const SECRET_ROTATED_EVENT = 'secret.rotated';

export interface SecretRotatedPayload {
  name: string;
  rotatedAt: string; // ISO-8601
}

export interface RotationRecord {
  name: string;
  /** Current secret value (in-memory only — never persisted or logged). */
  value: string;
  /** ISO-8601 timestamp of the last rotation. */
  lastRotatedAt: string;
  /** Rotation interval in milliseconds (0 = manual only). */
  intervalMs: number;
}

/**
 * RotationService — dynamic secrets rotation for backend credentials.
 *
 * Maintains an in-memory registry of named secrets.  Each secret can be:
 *   - Registered with an optional auto-rotation interval.
 *   - Rotated on demand via `rotate()`.
 *   - Read via `get()` — callers always receive the current value.
 *
 * On every rotation a `secret.rotated` event is emitted so consumers
 * (JWT module, DB connection pool, Redis client, etc.) can reload without
 * a process restart.
 *
 * Security properties preserved:
 *   - Secret values are never logged (only the secret name is logged).
 *   - No secret value is included in the emitted event payload.
 *   - `get()` returns `undefined` for unknown names — callers must handle
 *     the missing-secret case explicitly.
 *   - Auto-rotation timers are cleared on module destroy to prevent leaks.
 */
@Injectable()
export class RotationService implements OnModuleDestroy {
  private readonly logger = new Logger(RotationService.name);
  private readonly registry = new Map<string, RotationRecord>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly events: EventEmitter2) {}

  /**
   * Register a secret.
   *
   * @param name        Unique identifier for the secret.
   * @param initialValue The current value (e.g. read from env at startup).
   * @param intervalMs  Auto-rotation interval in ms.  Pass `0` to disable.
   */
  register(name: string, initialValue: string, intervalMs = 0): void {
    if (this.registry.has(name)) {
      this.logger.warn(`Secret "${name}" is already registered — skipping`);
      return;
    }

    this.registry.set(name, {
      name,
      value: initialValue,
      lastRotatedAt: new Date().toISOString(),
      intervalMs,
    });

    if (intervalMs > 0) {
      const timer = setInterval(() => this.rotate(name), intervalMs);
      this.timers.set(name, timer);
      this.logger.log(
        `Secret "${name}" registered with auto-rotation every ${intervalMs}ms`,
      );
    } else {
      this.logger.log(`Secret "${name}" registered (manual rotation only)`);
    }
  }

  /**
   * Rotate a secret immediately.
   *
   * Generates a cryptographically-random 32-byte hex string as the new value,
   * updates the registry, and emits `secret.rotated`.
   *
   * @returns The new secret value so the caller can propagate it if needed.
   */
  rotate(name: string): string {
    const record = this.registry.get(name);
    if (!record) {
      throw new Error(`Cannot rotate unknown secret "${name}"`);
    }

    const newValue = randomBytes(32).toString('hex');
    record.value = newValue;
    record.lastRotatedAt = new Date().toISOString();

    this.logger.log(`Secret "${name}" rotated at ${record.lastRotatedAt}`);

    const payload: SecretRotatedPayload = {
      name,
      rotatedAt: record.lastRotatedAt,
    };
    this.events.emit(SECRET_ROTATED_EVENT, payload);

    return newValue;
  }

  /**
   * Retrieve the current value of a registered secret.
   * Returns `undefined` when the secret is not registered.
   */
  get(name: string): string | undefined {
    return this.registry.get(name)?.value;
  }

  /**
   * Metadata snapshot for a secret (no value exposed).
   */
  getRecord(name: string): Omit<RotationRecord, 'value'> | undefined {
    const r = this.registry.get(name);
    if (!r) return undefined;
    return { name: r.name, lastRotatedAt: r.lastRotatedAt, intervalMs: r.intervalMs };
  }

  /** Names of all registered secrets. */
  listNames(): string[] {
    return Array.from(this.registry.keys());
  }

  onModuleDestroy(): void {
    for (const [name, timer] of this.timers) {
      clearInterval(timer);
      this.logger.log(`Auto-rotation timer cleared for secret "${name}"`);
    }
    this.timers.clear();
  }
}
