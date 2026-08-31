import { Injectable, Logger } from '@nestjs/common';

export interface TrackedSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  refreshTokenId: string;
  createdAt: Date;
  revokedAt: Date | null;
}

/**
 * Tracks active sessions per user/device and revokes refresh tokens on
 * demand, so a user can sign out one device or all devices explicitly.
 * Backed by an injectable store so it can sit on Redis/Postgres in
 * production; defaults to an in-memory map for local/test use.
 */
@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger(SessionRevocationService.name);
  private readonly sessions = new Map<string, TrackedSession>();

  track(session: Omit<TrackedSession, 'revokedAt'>): void {
    this.sessions.set(session.sessionId, { ...session, revokedAt: null });
  }

  getActiveSessions(userId: string): TrackedSession[] {
    return [...this.sessions.values()].filter(
      (s) => s.userId === userId && !s.revokedAt,
    );
  }

  /** Revoke a single session/device, invalidating its refresh token. */
  revokeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt) {
      return false;
    }
    session.revokedAt = new Date();
    this.logger.log(`Revoked session ${sessionId} for user ${session.userId}`);
    return true;
  }

  /** Revoke every active session for a user (e.g. "log out all devices"). */
  revokeAllForUser(userId: string, exceptSessionId?: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt && session.sessionId !== exceptSessionId) {
        session.revokedAt = new Date();
        count += 1;
      }
    }
    this.logger.log(`Revoked ${count} session(s) for user ${userId}`);
    return count;
  }

  isRefreshTokenRevoked(refreshTokenId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.refreshTokenId === refreshTokenId) {
        return !!session.revokedAt;
      }
    }
    return true;
  }
}
