import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  CredentialState,
  RotationPolicy,
  DEFAULT_ROTATION_POLICIES,
} from './rotation.types';

/**
 * CredentialOverlapService — manages the overlap window during secret rotation.
 *
 * When a credential is rotated the old value remains valid for a configurable
 * window so that in-flight requests (database connections using the old
 * password, JWT tokens signed with the old secret, etc.) are not interrupted.
 *
 * Security:
 *   - Credential values are never logged.
 *   - Old credentials are purged from memory as soon as their window expires.
 */
@Injectable()
export class CredentialOverlapService implements OnModuleDestroy {
  private readonly logger = new Logger(CredentialOverlapService.name);
  private readonly credentials = new Map<string, CredentialState>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Register a credential with its rotation policy.
   */
  register(name: string, currentValue: string, policy?: Partial<RotationPolicy>): void {
    const defaults = DEFAULT_ROTATION_POLICIES[name] ?? {};
    const fullPolicy: RotationPolicy = {
      name,
      type: policy?.type ?? defaults.type ?? 'api-key',
      overlapWindowMs: policy?.overlapWindowMs ?? defaults.overlapWindowMs ?? 5 * 60 * 1000,
      autoRotateIntervalMs: policy?.autoRotateIntervalMs ?? defaults.autoRotateIntervalMs ?? 0,
      maxPreviousCredentials: policy?.maxPreviousCredentials ?? defaults.maxPreviousCredentials ?? 1,
    };

    this.credentials.set(name, {
      current: currentValue,
      previous: [],
      lastRotatedAt: new Date().toISOString(),
      policy: fullPolicy,
    });

    this.logger.log(
      `Credential "${name}" registered (overlap window: ${fullPolicy.overlapWindowMs}ms)`,
    );
  }

  /**
   * Rotate a credential — the old value moves into the overlap window.
   *
   * @returns The new current value.
   */
  rotate(name: string, newValue: string): string {
    const state = this.credentials.get(name);
    if (!state) {
      throw new Error(`Credential "${name}" is not registered`);
    }

    const now = Date.now();
    const expiresAt = now + state.policy.overlapWindowMs;

    // Move current → previous (overlap)
    state.previous.push({ value: state.current, expiresAt });

    // Trim previous list to maxPreviousCredentials
    while (state.previous.length > state.policy.maxPreviousCredentials) {
      state.previous.shift();
    }

    state.current = newValue;
    state.lastRotatedAt = new Date().toISOString();

    // Schedule cleanup of the overlap entry
    this.scheduleOverlapCleanup(name, expiresAt);

    this.logger.log(
      `Credential "${name}" rotated — overlap window active until ${new Date(expiresAt).toISOString()}`,
    );

    return newValue;
  }

  /**
   * Validate whether a given value matches the current credential or any
   * credential still within its overlap window.
   *
   * This is used by consumers (JWT guard, DB pool, etc.) to accept both old
   * and new credentials during the transition.
   */
  validate(name: string, value: string): boolean {
    const state = this.credentials.get(name);
    if (!state) return false;

    // Check current
    if (state.current === value) return true;

    // Check previous (within overlap window)
    const now = Date.now();
    return state.previous.some((p) => p.value === value && p.expiresAt > now);
  }

  /**
   * Get the current credential value.
   */
  getCurrent(name: string): string | undefined {
    return this.credentials.get(name)?.current;
  }

  /**
   * Check whether the overlap window is currently active for a credential.
   */
  isOverlapActive(name: string): boolean {
    const state = this.credentials.get(name);
    if (!state) return false;
    const now = Date.now();
    return state.previous.some((p) => p.expiresAt > now);
  }

  /**
   * Get the state of a credential (without exposing values).
   */
  getState(name: string): Omit<CredentialState, 'current' | 'previous'> & {
    overlapActive: boolean;
    previousCount: number;
  } | undefined {
    const state = this.credentials.get(name);
    if (!state) return undefined;
    return {
      lastRotatedAt: state.lastRotatedAt,
      policy: state.policy,
      overlapActive: this.isOverlapActive(name),
      previousCount: state.previous.filter((p) => p.expiresAt > Date.now()).length,
    };
  }

  /** Names of all registered credentials. */
  listNames(): string[] {
    return Array.from(this.credentials.keys());
  }

  private scheduleOverlapCleanup(name: string, expiresAt: number): void {
    const delay = expiresAt - Date.now();
    if (delay <= 0) return;

    // Clear any existing timer for this credential
    const existing = this.cleanupTimers.get(name);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const state = this.credentials.get(name);
      if (state) {
        const now = Date.now();
        state.previous = state.previous.filter((p) => p.expiresAt > now);
        this.logger.log(`Overlap window expired for credential "${name}" — old values purged`);
      }
      this.cleanupTimers.delete(name);
    }, delay);

    this.cleanupTimers.set(name, timer);
  }

  onModuleDestroy(): void {
    for (const [name, timer] of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.credentials.clear();
  }
}
