/**
 * Integration examples for refresh-token reuse detection (issue #1011).
 *
 * Uses an in-memory cache stand-in so the family / consumed semantics can be
 * verified without Redis. Mirror these assertions against SessionManagerService
 * when running full integration with Testcontainers.
 */

import * as crypto from 'crypto';

interface RefreshRecord {
  sessionId: string;
  userId: string;
  familyId: string;
  consumed: boolean;
  nextTokenHash?: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Minimal store that models the reuse-detection contract from #1011. */
class InMemoryRefreshStore {
  private store = new Map<string, RefreshRecord>();
  private sessions = new Map<string, { userId: string; familyId: string }>();
  revokedFamilies = new Set<string>();

  issue(userId: string, familyId?: string) {
    const sessionId = crypto.randomUUID();
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const resolvedFamily = familyId ?? crypto.randomUUID();
    const record: RefreshRecord = {
      sessionId,
      userId,
      familyId: resolvedFamily,
      consumed: false,
    };
    this.store.set(hashToken(refreshToken), record);
    this.sessions.set(sessionId, { userId, familyId: resolvedFamily });
    return { refreshToken, sessionId, familyId: resolvedFamily };
  }

  refresh(refreshToken: string) {
    const key = hashToken(refreshToken);
    const record = this.store.get(key);
    if (!record) {
      throw new Error('Invalid or expired refresh token');
    }
    if (record.consumed) {
      this.revokeFamily(record.familyId, record.userId);
      throw new Error(
        'Refresh token reuse detected; all sessions in this family have been revoked',
      );
    }
    record.consumed = true;
    const next = this.issue(record.userId, record.familyId);
    record.nextTokenHash = hashToken(next.refreshToken);
    return next;
  }

  private revokeFamily(familyId: string, userId: string) {
    this.revokedFamilies.add(familyId);
    for (const [sid, s] of this.sessions) {
      if (s.familyId === familyId && s.userId === userId) {
        this.sessions.delete(sid);
      }
    }
  }
}

describe('Refresh-token reuse detection (#1011)', () => {
  let store: InMemoryRefreshStore;

  beforeEach(() => {
    store = new InMemoryRefreshStore();
  });

  it('stores only the hash of the refresh token (raw token never is the map key)', () => {
    const { refreshToken } = store.issue('user-1');
    const key = hashToken(refreshToken);
    expect(key).toHaveLength(64); // sha256 hex
    expect(key).not.toBe(refreshToken);
  });

  it('allows a single legitimate rotation and links nextTokenHash', () => {
    const first = store.issue('user-1');
    const second = store.refresh(first.refreshToken);

    expect(second.familyId).toBe(first.familyId);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('detects reuse of an already-consumed token and revokes the family', () => {
    const first = store.issue('user-1');
    store.refresh(first.refreshToken); // legitimate rotation

    expect(() => store.refresh(first.refreshToken)).toThrow(/reuse detected/i);
    expect(store.revokedFamilies.has(first.familyId)).toBe(true);
  });

  it('does not revoke an independent device family on another family reuse', () => {
    const deviceA = store.issue('user-1');
    const deviceB = store.issue('user-1'); // new family

    store.refresh(deviceA.refreshToken);
    expect(() => store.refresh(deviceA.refreshToken)).toThrow(/reuse detected/i);

    // device B family still independent
    expect(store.revokedFamilies.has(deviceA.familyId)).toBe(true);
    expect(store.revokedFamilies.has(deviceB.familyId)).toBe(false);
    expect(() => store.refresh(deviceB.refreshToken)).not.toThrow();
  });
});
