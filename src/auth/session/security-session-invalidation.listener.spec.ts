import {
  SECURITY_SESSION_EVENTS,
  SESSION_INVALIDATION_POLICY,
  SecuritySessionInvalidationListener,
} from './security-session-invalidation.listener';

describe('SecuritySessionInvalidationListener', () => {
  let sessions: Set<string>;
  let sessionManager: { getUserSessions: jest.Mock; deleteSession: jest.Mock };
  let events: { emit: jest.Mock };
  let listener: SecuritySessionInvalidationListener;

  beforeEach(() => {
    sessions = new Set(['s1', 's2', 's3']);
    sessionManager = {
      getUserSessions: jest.fn(async () => [...sessions]),
      deleteSession: jest.fn(async (id: string) => {
        sessions.delete(id);
      }),
    };
    events = { emit: jest.fn() };
    listener = new SecuritySessionInvalidationListener(
      sessionManager as any,
      events as any,
    );
    jest.spyOn((listener as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((listener as any).logger, 'error').mockImplementation(() => {});
  });

  describe('policy', () => {
    it('preserves the current session for 2FA changes but not for compromise', () => {
      expect(
        SESSION_INVALIDATION_POLICY[SECURITY_SESSION_EVENTS.TWO_FACTOR_ENABLED],
      ).toEqual({
        preserveCurrentSession: true,
      });
      expect(
        SESSION_INVALIDATION_POLICY[
          SECURITY_SESSION_EVENTS.TWO_FACTOR_DISABLED
        ],
      ).toEqual({
        preserveCurrentSession: true,
      });
      expect(
        SESSION_INVALIDATION_POLICY[
          SECURITY_SESSION_EVENTS.TWO_FACTOR_BACKUP_CODES_REGENERATED
        ],
      ).toEqual({ preserveCurrentSession: true });
      expect(
        SESSION_INVALIDATION_POLICY[
          SECURITY_SESSION_EVENTS.REFRESH_TOKEN_REUSE
        ],
      ).toEqual({
        preserveCurrentSession: false,
      });
      expect(
        SESSION_INVALIDATION_POLICY[
          SECURITY_SESSION_EVENTS.ACCOUNT_COMPROMISED
        ],
      ).toEqual({
        preserveCurrentSession: false,
      });
    });
  });

  it('revokes all sessions after 2FA is disabled when no current session is given', async () => {
    const result = await listener.onTwoFactorDisabled({ userId: 'u1' });

    expect(result.revokedSessionIds.sort()).toEqual(['s1', 's2', 's3']);
    expect(sessions.size).toBe(0);
  });

  it('keeps the current session after a 2FA change', async () => {
    const result = await listener.onTwoFactorEnabled({
      userId: 'u1',
      currentSessionId: 's2',
    });

    expect(result.preservedSessionId).toBe('s2');
    expect(result.revokedSessionIds.sort()).toEqual(['s1', 's3']);
    expect([...sessions]).toEqual(['s2']);
  });

  it('revokes the current session too on suspected compromise', async () => {
    const result = await listener.onAccountCompromised({
      userId: 'u1',
      currentSessionId: 's2',
    });

    expect(result.preservedSessionId).toBeUndefined();
    expect(sessions.size).toBe(0);
  });

  it('revokes all sessions on refresh token reuse', async () => {
    await listener.onRefreshTokenReuse({ userId: 'u1' });

    expect(sessions.size).toBe(0);
  });

  it('is idempotent across repeated invalidations', async () => {
    await listener.onAccountCompromised({ userId: 'u1' });
    const second = await listener.onAccountCompromised({ userId: 'u1' });

    expect(second.revokedSessionIds).toEqual([]);
    expect(second.failedSessionIds).toEqual([]);
    expect(sessionManager.deleteSession).toHaveBeenCalledTimes(3);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('reports sessions that fail to revoke without throwing', async () => {
    sessionManager.deleteSession.mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('redis down');
      sessions.delete(id);
    });

    const result = await listener.onAccountCompromised({ userId: 'u1' });

    expect(result.revokedSessionIds.sort()).toEqual(['s1', 's3']);
    expect(result.failedSessionIds).toEqual(['s2']);
    expect(events.emit).toHaveBeenCalledWith(
      SECURITY_SESSION_EVENTS.INVALIDATION_FAILED,
      expect.objectContaining({ userId: 'u1', failedSessionIds: ['s2'] }),
    );
  });

  it('reports a failure when sessions cannot be listed', async () => {
    sessionManager.getUserSessions.mockRejectedValue(new Error('redis down'));

    await expect(
      listener.onTwoFactorDisabled({ userId: 'u1' }),
    ).resolves.toMatchObject({
      revokedSessionIds: [],
    });
    expect(events.emit).toHaveBeenCalledWith(
      SECURITY_SESSION_EVENTS.INVALIDATION_FAILED,
      expect.objectContaining({ userId: 'u1', reason: 'redis down' }),
    );
  });
});
