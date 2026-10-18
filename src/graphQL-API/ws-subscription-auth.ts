import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { SessionManagerService } from '../auth/session/session-manager.service';
import type { UsersService } from '../users/users.service';

/**
 * Minimal shape of a `graphql-ws` `Context` that this module depends on.
 *
 * Declared locally instead of importing the type from the `graphql-ws`
 * package so this file only depends on it *structurally* — `onConnect`
 * receives an object with `connectionParams` (whatever the client passed to
 * `connection_init`) and a per-connection `extra` bag that graphql-ws keeps
 * alive for the lifetime of the socket.
 */
export interface GraphqlWsConnectionContext {
  connectionParams?: Record<string, unknown>;
  extra: Record<string, unknown>;
}

/** Authenticated user attached to a subscription operation's GraphQL context. */
export interface AuthenticatedSubscriptionUser {
  id: string;
  userId: string;
  username?: string;
  walletAddress?: string;
  sessionId?: string;
  /** JWT `exp` claim, in epoch milliseconds, when present on the token. */
  tokenExpiresAt?: number;
}

/**
 * `graphql-ws` close code used when a connection is closed because the
 * credentials it was authenticated with have expired. In the `4000`–`4999`
 * range reserved for application use (outside the standard WS/`graphql-ws`
 * close codes), so clients can tell "please reauthenticate and reconnect"
 * apart from a generic/protocol error.
 */
export const SUBSCRIPTION_AUTH_EXPIRED_CLOSE_CODE = 4401;

/** Raised when a `graphql-ws` `connection_init` handshake fails authentication. */
export class SubscriptionAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionAuthError';
  }
}

/**
 * `connectionParams` keys accepted for the bearer token. The standard
 * `graphql-ws` client sends auth via `connectionParams`, conventionally
 * under `authorization`; we also accept the header-cased variant since
 * different client setups (and this repo's own HTTP convention) use
 * `Authorization`.
 */
const TOKEN_PARAM_KEYS = ['authorization', 'Authorization'] as const;

/** Pulls the bearer token out of a `graphql-ws` `connectionParams` payload. */
export function extractSubscriptionToken(
  connectionParams: Record<string, unknown> | null | undefined,
): string | null {
  if (!connectionParams) return null;

  for (const key of TOKEN_PARAM_KEYS) {
    const raw = connectionParams[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim().replace(/^Bearer\s+/i, '').trim();
    }
  }

  return null;
}

export interface SubscriptionAuthDeps {
  jwtService: Pick<JwtService, 'verifyAsync'>;
  configService: Pick<ConfigService, 'get'>;
  usersService: Pick<UsersService, 'findById'>;
  sessionManager: Pick<SessionManagerService, 'getSession'>;
}

/**
 * Validates a `graphql-ws` connection at handshake (`connection_init`) time.
 *
 * Reuses the same JWT secret + verification approach already used elsewhere
 * in this codebase — the HTTP `GqlAuthGuard` (Passport `jwt` strategy /
 * `JwtStrategy.validate`) and the Socket.IO `WsJwtGuard` — rather than
 * inventing a new mechanism: same `jwt.secret` config key, same
 * session-revocation check (`SessionManagerService.getSession`), same
 * "user must exist and be active" check.
 *
 * Always throws `SubscriptionAuthError` on any failure (missing token,
 * invalid/expired token, revoked session, inactive/missing user) so the
 * caller can reject the WS connection outright, before any subscription is
 * ever created.
 */
export async function authenticateGraphqlWsConnection(
  connectionParams: Record<string, unknown> | null | undefined,
  deps: SubscriptionAuthDeps,
): Promise<AuthenticatedSubscriptionUser> {
  const token = extractSubscriptionToken(connectionParams);
  if (!token) {
    throw new SubscriptionAuthError('Missing authentication token for subscription connection');
  }

  let payload: JwtPayload;
  try {
    payload = await deps.jwtService.verifyAsync<JwtPayload>(token, {
      secret: deps.configService.get<string>('jwt.secret'),
    });
  } catch {
    throw new SubscriptionAuthError('Invalid or expired authentication token');
  }

  if (!payload?.sub) {
    throw new SubscriptionAuthError('Invalid authentication token payload');
  }

  if (payload.sid) {
    const session = await deps.sessionManager.getSession(payload.sid);
    if (!session) {
      throw new SubscriptionAuthError('Session has been revoked');
    }
  }

  let user: { id: string; username?: string; walletAddress?: string; isActive?: boolean } | undefined;
  try {
    user = await deps.usersService.findById(payload.sub);
  } catch {
    throw new SubscriptionAuthError('User is inactive or not found');
  }

  if (!user || !user.isActive) {
    throw new SubscriptionAuthError('User is inactive or not found');
  }

  return {
    id: user.id,
    userId: user.id,
    username: user.username,
    walletAddress: user.walletAddress,
    sessionId: payload.sid,
    tokenExpiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : undefined,
  };
}

/**
 * Schedules this connection to be closed the moment its token expires,
 * clearing any timer scheduled by a previous call for the same connection
 * first (re-handshakes, if the client reconnects with a fresh token, must
 * not leave the old timer armed).
 *
 * Tokens without an `exp` claim are left alone — there's nothing to expire.
 */
function scheduleExpiryClose(
  context: GraphqlWsConnectionContext,
  user: AuthenticatedSubscriptionUser,
): void {
  clearScheduledExpiryClose(context);

  if (!user.tokenExpiresAt) return;

  const delayMs = Math.max(user.tokenExpiresAt - Date.now(), 0);
  const timer = setTimeout(() => {
    const socket = context.extra.socket as
      | { close?: (code: number, reason: string) => void }
      | undefined;
    socket?.close?.(
      SUBSCRIPTION_AUTH_EXPIRED_CLOSE_CODE,
      'Authentication expired — reconnect with a fresh token',
    );
  }, delayMs);
  // Don't let this timer alone keep the process alive (e.g. during tests
  // or graceful shutdown) — the open socket already does that while the
  // connection is genuinely active.
  timer.unref?.();

  context.extra.expiryTimer = timer;
}

/** Clears a timer scheduled by `scheduleExpiryClose`, if any, for this connection. */
function clearScheduledExpiryClose(context: GraphqlWsConnectionContext): void {
  const timer = context.extra.expiryTimer as NodeJS.Timeout | undefined;
  if (timer) {
    clearTimeout(timer);
    delete context.extra.expiryTimer;
  }
}

/**
 * Builds the `onConnect` / `context` pair passed to `@nestjs/apollo`'s
 * `subscriptions['graphql-ws']` option (wired up in `graphql.module.ts`).
 *
 * - `onConnect` runs once per WS connection, at handshake time — throwing
 *   (via `authenticateGraphqlWsConnection`) refuses the connection before
 *   the client can ever send a `subscribe` message, which is the
 *   "authentication enforced at handshake time" behaviour the issue asks
 *   for.
 * - `context` runs once per subscription operation on an already-accepted
 *   connection. It reads the user stashed on `extra` during `onConnect` and
 *   merges it into the GraphQL execution context, so `@Subscription()`
 *   resolvers and `GqlAuthGuard` can read `context.user`.
 * - `onDisconnect` runs once the connection closes for any reason, and
 *   clears the expiry timer armed by `onConnect` so a closed connection
 *   never leaves a dangling timer behind.
 *
 * Reauthentication policy for long-lived subscriptions (#1384): rather than
 * silently letting a subscription keep delivering protected events past the
 * lifetime of the token that authorized it, `onConnect` arms a timer for the
 * token's `exp` claim. When it fires, the underlying socket is closed with
 * `SUBSCRIPTION_AUTH_EXPIRED_CLOSE_CODE` — `graphql-ws` clients treat a
 * non-1000 close as "reconnect", so a client holding a refreshed token
 * simply re-handshakes (`connection_init` → `onConnect` again) with it. A
 * client with no fresh token to offer fails the next handshake the same way
 * any other expired/invalid token does, and stops receiving events.
 */
export function createGraphqlWsAuthHandlers(deps: SubscriptionAuthDeps): {
  onConnect: (context: GraphqlWsConnectionContext) => Promise<void>;
  context: (context: GraphqlWsConnectionContext) => { user?: AuthenticatedSubscriptionUser };
  onDisconnect: (context: GraphqlWsConnectionContext) => void;
} {
  return {
    onConnect: async (context: GraphqlWsConnectionContext) => {
      const user = await authenticateGraphqlWsConnection(context.connectionParams, deps);
      // Stash on `extra` — the per-operation `context` below (and therefore
      // every subscription resolver) reads it back out as `context.user`.
      context.extra.user = user;
      scheduleExpiryClose(context, user);
    },
    context: (context: GraphqlWsConnectionContext) => ({
      user: context.extra?.user as AuthenticatedSubscriptionUser | undefined,
    }),
    onDisconnect: (context: GraphqlWsConnectionContext) => {
      clearScheduledExpiryClose(context);
    },
  };
}
