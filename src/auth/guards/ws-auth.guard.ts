import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

export interface WsUser {
  sub: string;
  roles?: string[];
  rooms?: string[];
  exp?: number;
}

export interface AuthenticatedSocket extends Socket {
  user?: WsUser;
}

/**
 * Guard that authenticates WebSocket handshakes and authorizes room access.
 *
 * - Handshake: requires a valid bearer token (Authorization header or
 *   `auth.token` payload). Unauthenticated handshakes are rejected.
 * - Authorization: room subscriptions are validated against the token's
 *   granted rooms/roles before the client is allowed to join.
 * - Expiry/revocation: connections are closed consistently when the token
 *   expires or is revoked.
 */
@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);

  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = this.getClient(context);
    if (!client) {
      return false;
    }

    const token = this.extractToken(client);
    if (!token) {
      this.reject(client, 'Missing authentication token');
      return false;
    }

    let payload: WsUser;
    try {
      payload = this.jwtService.verify<WsUser>(token);
    } catch (err) {
      this.reject(client, 'Invalid or expired token');
      return false;
    }

    if (!payload?.sub) {
      this.reject(client, 'Token missing subject');
      return false;
    }

    client.user = payload;
    this.scheduleExpiry(client, payload);
    return true;
  }

  /**
   * Recheck authorization for a room before allowing a subscription/join.
   * Call from the `join`/`subscribe` handler.
   */
  authorizeRoom(client: AuthenticatedSocket, room: string): boolean {
    const user = client.user;
    if (!user) {
      this.reject(client, 'Unauthenticated');
      return false;
    }

    if (this.isExpired(user)) {
      this.reject(client, 'Credentials expired');
      return false;
    }

    const allowedRooms = user.rooms ?? [];
    const isAdmin = (user.roles ?? []).includes('admin');
    if (!isAdmin && !allowedRooms.includes(room)) {
      this.logger.warn(`User ${user.sub} denied access to room ${room}`);
      client.emit('error', { message: 'Forbidden: room access denied' });
      return false;
    }

    return true;
  }

  /**
   * Close a connection consistently when credentials are revoked.
   */
  revoke(client: AuthenticatedSocket, reason = 'Credentials revoked'): void {
    this.reject(client, reason);
  }

  private getClient(context: ExecutionContext): AuthenticatedSocket | undefined {
    const type = context.getType<string>();
    if (type === 'ws') {
      return context.switchToWs().getClient<AuthenticatedSocket>();
    }
    return context.switchToHttp().getRequest<AuthenticatedSocket>();
  }

  private extractToken(client: AuthenticatedSocket): string | undefined {
    const authHeader = client.handshake?.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length);
    }
    const authToken = (client.handshake?.auth as { token?: string } | undefined)?.token;
    return authToken;
  }

  private isExpired(user: WsUser): boolean {
    return typeof user.exp === 'number' && user.exp * 1000 <= Date.now();
  }

  private scheduleExpiry(client: AuthenticatedSocket, user: WsUser): void {
    if (typeof user.exp !== 'number') {
      return;
    }
    const ttl = user.exp * 1000 - Date.now();
    if (ttl <= 0) {
      this.reject(client, 'Credentials expired');
      return;
    }
    const timer = setTimeout(() => this.reject(client, 'Credentials expired'), ttl);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  private reject(client: AuthenticatedSocket, message: string): void {
    this.logger.warn(`Closing WebSocket connection: ${message}`);
    try {
      client.emit('unauthorized', { message });
    } catch {
      // ignore emit failures on already-closed sockets
    }
    client.disconnect(true);
  }
}
