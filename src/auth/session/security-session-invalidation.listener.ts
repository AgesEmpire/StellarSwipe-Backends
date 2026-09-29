import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { SessionManagerService } from './session-manager.service';

export const SECURITY_SESSION_EVENTS = {
  TWO_FACTOR_ENABLED: 'auth.2fa.enabled',
  TWO_FACTOR_DISABLED: 'auth.2fa.disabled',
  TWO_FACTOR_BACKUP_CODES_REGENERATED: 'auth.2fa.backup_codes_regenerated',
  REFRESH_TOKEN_REUSE: 'security.refresh_token_reuse',
  ACCOUNT_COMPROMISED: 'security.account_compromised',
  INVALIDATION_FAILED: 'security.session_invalidation_failed',
} as const;

export type SecuritySessionEvent = Exclude<
  (typeof SECURITY_SESSION_EVENTS)[keyof typeof SECURITY_SESSION_EVENTS],
  typeof SECURITY_SESSION_EVENTS.INVALIDATION_FAILED
>;

export interface SecuritySessionEventPayload {
  userId: string;
  /** Session that performed the change; only kept when the policy allows it. */
  currentSessionId?: string;
}

/**
 * Explicit policy for which sessions each security event revokes.
 * - 2FA changes: every other session is revoked; the session that made the
 *   change is kept only when its id is supplied.
 * - Suspected compromise: every session is revoked, including the current one.
 */
export const SESSION_INVALIDATION_POLICY: Record<
  SecuritySessionEvent,
  { preserveCurrentSession: boolean }
> = {
  [SECURITY_SESSION_EVENTS.TWO_FACTOR_ENABLED]: {
    preserveCurrentSession: true,
  },
  [SECURITY_SESSION_EVENTS.TWO_FACTOR_DISABLED]: {
    preserveCurrentSession: true,
  },
  [SECURITY_SESSION_EVENTS.TWO_FACTOR_BACKUP_CODES_REGENERATED]: {
    preserveCurrentSession: true,
  },
  [SECURITY_SESSION_EVENTS.REFRESH_TOKEN_REUSE]: {
    preserveCurrentSession: false,
  },
  [SECURITY_SESSION_EVENTS.ACCOUNT_COMPROMISED]: {
    preserveCurrentSession: false,
  },
};

export interface SessionInvalidationResult {
  userId: string;
  event: SecuritySessionEvent;
  revokedSessionIds: string[];
  failedSessionIds: string[];
  preservedSessionId?: string;
}

@Injectable()
export class SecuritySessionInvalidationListener {
  private readonly logger = new Logger(
    SecuritySessionInvalidationListener.name,
  );

  constructor(
    private readonly sessionManager: SessionManagerService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  @OnEvent(SECURITY_SESSION_EVENTS.TWO_FACTOR_ENABLED)
  onTwoFactorEnabled(payload: SecuritySessionEventPayload) {
    return this.invalidate(SECURITY_SESSION_EVENTS.TWO_FACTOR_ENABLED, payload);
  }

  @OnEvent(SECURITY_SESSION_EVENTS.TWO_FACTOR_DISABLED)
  onTwoFactorDisabled(payload: SecuritySessionEventPayload) {
    return this.invalidate(
      SECURITY_SESSION_EVENTS.TWO_FACTOR_DISABLED,
      payload,
    );
  }

  @OnEvent(SECURITY_SESSION_EVENTS.TWO_FACTOR_BACKUP_CODES_REGENERATED)
  onBackupCodesRegenerated(payload: SecuritySessionEventPayload) {
    return this.invalidate(
      SECURITY_SESSION_EVENTS.TWO_FACTOR_BACKUP_CODES_REGENERATED,
      payload,
    );
  }

  @OnEvent(SECURITY_SESSION_EVENTS.REFRESH_TOKEN_REUSE)
  onRefreshTokenReuse(payload: SecuritySessionEventPayload) {
    return this.invalidate(
      SECURITY_SESSION_EVENTS.REFRESH_TOKEN_REUSE,
      payload,
    );
  }

  @OnEvent(SECURITY_SESSION_EVENTS.ACCOUNT_COMPROMISED)
  onAccountCompromised(payload: SecuritySessionEventPayload) {
    return this.invalidate(
      SECURITY_SESSION_EVENTS.ACCOUNT_COMPROMISED,
      payload,
    );
  }

  /**
   * Revokes the user's sessions according to SESSION_INVALIDATION_POLICY.
   * Idempotent: sessions already revoked are simply absent on later calls.
   * Never throws; failures are logged and emitted for alerting.
   */
  async invalidate(
    event: SecuritySessionEvent,
    payload: SecuritySessionEventPayload,
  ): Promise<SessionInvalidationResult> {
    const { userId, currentSessionId } = payload;
    const preservedSessionId = SESSION_INVALIDATION_POLICY[event]
      .preserveCurrentSession
      ? currentSessionId
      : undefined;
    const result: SessionInvalidationResult = {
      userId,
      event,
      revokedSessionIds: [],
      failedSessionIds: [],
      preservedSessionId,
    };

    let sessionIds: string[];
    try {
      sessionIds = await this.sessionManager.getUserSessions(userId);
    } catch (error) {
      this.reportFailure(result, (error as Error).message);
      return result;
    }

    const targets = sessionIds.filter((id) => id !== preservedSessionId);
    const outcomes = await Promise.allSettled(
      targets.map((id) => this.sessionManager.deleteSession(id)),
    );
    outcomes.forEach((outcome, i) => {
      (outcome.status === 'fulfilled'
        ? result.revokedSessionIds
        : result.failedSessionIds
      ).push(targets[i]);
    });

    if (result.failedSessionIds.length > 0) {
      this.reportFailure(
        result,
        `failed to revoke ${result.failedSessionIds.length} session(s)`,
      );
    } else {
      this.logger.log(
        `Revoked ${result.revokedSessionIds.length} session(s) for user ${userId} after ${event}`,
      );
    }
    return result;
  }

  private reportFailure(
    result: SessionInvalidationResult,
    reason: string,
  ): void {
    this.logger.error(
      `Session invalidation for user ${result.userId} after ${result.event} failed: ${reason}`,
    );
    this.events?.emit(SECURITY_SESSION_EVENTS.INVALIDATION_FAILED, {
      ...result,
      reason,
    });
  }
}
