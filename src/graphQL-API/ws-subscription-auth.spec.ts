import {
  extractSubscriptionToken,
  authenticateGraphqlWsConnection,
  createGraphqlWsAuthHandlers,
  SubscriptionAuthError,
  GraphqlWsConnectionContext,
  SubscriptionAuthDeps,
} from './ws-subscription-auth';

describe('extractSubscriptionToken', () => {
  it('returns null when connectionParams is missing', () => {
    expect(extractSubscriptionToken(undefined)).toBeNull();
    expect(extractSubscriptionToken(null)).toBeNull();
  });

  it('returns null when no recognised token key is present', () => {
    expect(extractSubscriptionToken({ foo: 'bar' })).toBeNull();
  });

  it('extracts a raw token from the lowercase `authorization` key', () => {
    expect(extractSubscriptionToken({ authorization: 'my-token' })).toBe('my-token');
  });

  it('extracts a token from the header-cased `Authorization` key', () => {
    expect(extractSubscriptionToken({ Authorization: 'my-token' })).toBe('my-token');
  });

  it('strips a `Bearer ` prefix (case-insensitive) and trims whitespace', () => {
    expect(extractSubscriptionToken({ authorization: '  Bearer   my-token  ' })).toBe('my-token');
    expect(extractSubscriptionToken({ authorization: 'bearer my-token' })).toBe('my-token');
  });

  it('ignores empty-string tokens', () => {
    expect(extractSubscriptionToken({ authorization: '   ' })).toBeNull();
  });
});

describe('authenticateGraphqlWsConnection', () => {
  const validPayload = { sub: 'user-1', sid: 'session-1' };
  const activeUser = {
    id: 'user-1',
    username: 'alice',
    walletAddress: 'GABC...',
    isActive: true,
  };

  function buildDeps(overrides: Partial<SubscriptionAuthDeps> = {}): SubscriptionAuthDeps {
    return {
      jwtService: { verifyAsync: jest.fn().mockResolvedValue(validPayload) },
      configService: { get: jest.fn().mockReturnValue('test-secret') },
      usersService: { findById: jest.fn().mockResolvedValue(activeUser) },
      sessionManager: { getSession: jest.fn().mockResolvedValue({ userId: 'user-1' } as any) },
      ...overrides,
    } as SubscriptionAuthDeps;
  }

  it('resolves with the authenticated user for a connection with a valid token', async () => {
    const deps = buildDeps();

    const user = await authenticateGraphqlWsConnection({ authorization: 'Bearer good-token' }, deps);

    expect(user).toEqual({
      id: 'user-1',
      userId: 'user-1',
      username: 'alice',
      walletAddress: 'GABC...',
      sessionId: 'session-1',
    });
    expect(deps.jwtService.verifyAsync).toHaveBeenCalledWith(
      'good-token',
      expect.objectContaining({ secret: 'test-secret' }),
    );
  });

  it('rejects a connection with no token at all', async () => {
    const deps = buildDeps();

    await expect(authenticateGraphqlWsConnection({}, deps)).rejects.toThrow(SubscriptionAuthError);
    await expect(authenticateGraphqlWsConnection(undefined, deps)).rejects.toThrow(
      SubscriptionAuthError,
    );
    expect(deps.jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a connection with an invalid/expired token', async () => {
    const deps = buildDeps({
      jwtService: { verifyAsync: jest.fn().mockRejectedValue(new Error('jwt expired')) },
    });

    await expect(
      authenticateGraphqlWsConnection({ authorization: 'Bearer bad-token' }, deps),
    ).rejects.toThrow(SubscriptionAuthError);
  });

  it('rejects a token whose payload has no subject', async () => {
    const deps = buildDeps({
      jwtService: { verifyAsync: jest.fn().mockResolvedValue({}) },
    });

    await expect(
      authenticateGraphqlWsConnection({ authorization: 'Bearer token' }, deps),
    ).rejects.toThrow(SubscriptionAuthError);
  });

  it('rejects when the session tied to the token has been revoked', async () => {
    const deps = buildDeps({
      sessionManager: { getSession: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      authenticateGraphqlWsConnection({ authorization: 'Bearer token' }, deps),
    ).rejects.toThrow(SubscriptionAuthError);
  });

  it('rejects when the user no longer exists', async () => {
    const deps = buildDeps({
      usersService: { findById: jest.fn().mockRejectedValue(new Error('not found')) },
    });

    await expect(
      authenticateGraphqlWsConnection({ authorization: 'Bearer token' }, deps),
    ).rejects.toThrow(SubscriptionAuthError);
  });

  it('rejects when the user account is inactive', async () => {
    const deps = buildDeps({
      usersService: { findById: jest.fn().mockResolvedValue({ ...activeUser, isActive: false }) },
    });

    await expect(
      authenticateGraphqlWsConnection({ authorization: 'Bearer token' }, deps),
    ).rejects.toThrow(SubscriptionAuthError);
  });
});

describe('createGraphqlWsAuthHandlers (graphql-ws handshake wiring)', () => {
  const validPayload = { sub: 'user-1', sid: 'session-1' };
  const activeUser = { id: 'user-1', username: 'alice', walletAddress: 'GABC...', isActive: true };

  function buildDeps(overrides: Partial<SubscriptionAuthDeps> = {}): SubscriptionAuthDeps {
    return {
      jwtService: { verifyAsync: jest.fn().mockResolvedValue(validPayload) },
      configService: { get: jest.fn().mockReturnValue('test-secret') },
      usersService: { findById: jest.fn().mockResolvedValue(activeUser) },
      sessionManager: { getSession: jest.fn().mockResolvedValue({ userId: 'user-1' } as any) },
      ...overrides,
    } as SubscriptionAuthDeps;
  }

  function buildConnectionContext(
    connectionParams?: Record<string, unknown>,
  ): GraphqlWsConnectionContext {
    return { connectionParams, extra: {} };
  }

  it('accepts the connection and stashes the authenticated user on `extra` for a valid token', async () => {
    const handlers = createGraphqlWsAuthHandlers(buildDeps());
    const ctx = buildConnectionContext({ authorization: 'Bearer good-token' });

    await expect(handlers.onConnect(ctx)).resolves.toBeUndefined();

    expect(ctx.extra.user).toEqual({
      id: 'user-1',
      userId: 'user-1',
      username: 'alice',
      walletAddress: 'GABC...',
      sessionId: 'session-1',
    });
  });

  it('makes the authenticated user available to a subscription operation via `context.user`', async () => {
    const handlers = createGraphqlWsAuthHandlers(buildDeps());
    const ctx = buildConnectionContext({ authorization: 'Bearer good-token' });

    await handlers.onConnect(ctx);
    const operationContext = handlers.context(ctx);

    expect(operationContext.user?.id).toBe('user-1');
  });

  it('rejects the connection at handshake time when the token is missing', async () => {
    const handlers = createGraphqlWsAuthHandlers(buildDeps());
    const ctx = buildConnectionContext(undefined);

    await expect(handlers.onConnect(ctx)).rejects.toThrow(SubscriptionAuthError);
    // No subscription should ever see a user for a connection that was refused.
    expect(ctx.extra.user).toBeUndefined();
  });

  it('rejects the connection at handshake time when the token is invalid, before any subscription context is built', async () => {
    const handlers = createGraphqlWsAuthHandlers(
      buildDeps({
        jwtService: { verifyAsync: jest.fn().mockRejectedValue(new Error('invalid signature')) },
      }),
    );
    const ctx = buildConnectionContext({ authorization: 'Bearer tampered-token' });

    await expect(handlers.onConnect(ctx)).rejects.toThrow(SubscriptionAuthError);
    expect(handlers.context(ctx).user).toBeUndefined();
  });
});

describe('createGraphqlWsAuthHandlers (expiry reauthentication, #1384)', () => {
  const activeUser = { id: 'user-1', username: 'alice', walletAddress: 'GABC...', isActive: true };

  function buildDeps(overrides: Partial<SubscriptionAuthDeps> = {}): SubscriptionAuthDeps {
    return {
      jwtService: { verifyAsync: jest.fn() },
      configService: { get: jest.fn().mockReturnValue('test-secret') },
      usersService: { findById: jest.fn().mockResolvedValue(activeUser) },
      sessionManager: { getSession: jest.fn().mockResolvedValue({ userId: 'user-1' } as any) },
      ...overrides,
    } as SubscriptionAuthDeps;
  }

  function buildConnectionContext(
    connectionParams?: Record<string, unknown>,
  ): GraphqlWsConnectionContext & { extra: { socket: { close: jest.Mock } } } {
    return { connectionParams, extra: { socket: { close: jest.fn() } } };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes the socket once the token in use has reached its `exp` claim', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const deps = buildDeps({
      jwtService: {
        verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', exp: nowSeconds + 60 }),
      },
    });
    const handlers = createGraphqlWsAuthHandlers(deps);
    const ctx = buildConnectionContext({ authorization: 'Bearer good-token' });

    await handlers.onConnect(ctx);
    expect(ctx.extra.socket.close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60_000);

    expect(ctx.extra.socket.close).toHaveBeenCalledWith(4401, expect.stringContaining('expired'));
  });

  it('does not schedule a close for a token with no `exp` claim', async () => {
    const deps = buildDeps({
      jwtService: { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1' }) },
    });
    const handlers = createGraphqlWsAuthHandlers(deps);
    const ctx = buildConnectionContext({ authorization: 'Bearer good-token' });

    await handlers.onConnect(ctx);
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(ctx.extra.socket.close).not.toHaveBeenCalled();
  });

  it('clears the expiry timer on disconnect so it never fires for a closed connection', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const deps = buildDeps({
      jwtService: {
        verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', exp: nowSeconds + 60 }),
      },
    });
    const handlers = createGraphqlWsAuthHandlers(deps);
    const ctx = buildConnectionContext({ authorization: 'Bearer good-token' });

    await handlers.onConnect(ctx);
    handlers.onDisconnect(ctx);
    jest.advanceTimersByTime(60_000);

    expect(ctx.extra.socket.close).not.toHaveBeenCalled();
  });

  it('replaces the previous timer when a connection re-authenticates with a new token', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const deps = buildDeps({
      jwtService: {
        verifyAsync: jest
          .fn()
          .mockResolvedValueOnce({ sub: 'user-1', exp: nowSeconds + 60 })
          .mockResolvedValueOnce({ sub: 'user-1', exp: nowSeconds + 300 }),
      },
    });
    const handlers = createGraphqlWsAuthHandlers(deps);
    const ctx = buildConnectionContext({ authorization: 'Bearer first-token' });

    await handlers.onConnect(ctx);
    await handlers.onConnect(ctx); // re-handshake with a longer-lived token

    jest.advanceTimersByTime(60_000);
    expect(ctx.extra.socket.close).not.toHaveBeenCalled();

    jest.advanceTimersByTime(240_000);
    expect(ctx.extra.socket.close).toHaveBeenCalledTimes(1);
  });
});
