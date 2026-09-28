import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { SessionManagerService } from '../../auth/session/session-manager.service';

export interface WsAuthenticatedUser extends JwtPayload {
  sub: string;
}

/**
 * Consolidated WebSocket JWT guard.
 * Validates Bearer token from socket handshake and optionally validates session.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly sessionManager?: SessionManagerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    await this.validateSocket(client);
    return true;
  }

  async validateSocket(client: Socket): Promise<WsAuthenticatedUser> {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(`WS connection ${client.id} rejected: no token`);
      throw new UnauthorizedException('Missing authentication token');
    }

    let payload: JwtPayload;
    try {
      const verifyOptions = this.configService
        ? { secret: this.configService.get<string>('jwt.secret') }
        : {};
      payload = this.jwtService.verify<JwtPayload>(token, verifyOptions);
    } catch {
      this.logger.warn(`WS connection ${client.id} rejected: invalid token`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    const subject = typeof payload?.sub === 'string' ? payload.sub.trim() : '';
    if (!subject) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Validate session if session manager is available
    if (payload.sid && this.sessionManager) {
      const session = await this.sessionManager.getSession(payload.sid);
      if (!session) {
        this.logger.warn(`WS connection ${client.id} rejected: session revoked`);
        throw new UnauthorizedException('Session has been revoked');
      }
    }

    const user: WsAuthenticatedUser = { ...payload, sub: subject };
    client.data = client.data ?? {};
    client.data.user = user;
    client.data.walletAddress = user.sub;

    return user;
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      return this.stripBearerPrefix(authToken);
    }

    const authorizationHeader = this.resolveAuthorizationHeader(client);
    if (authorizationHeader) {
      return this.stripBearerPrefix(authorizationHeader);
    }

    return null;
  }

  private resolveAuthorizationHeader(client: Socket): string | null {
    const headers = client.handshake.headers ?? {};
    const rawHeader = headers.authorization ?? headers.Authorization;
    if (Array.isArray(rawHeader)) {
      return rawHeader[0] ?? null;
    }

    return typeof rawHeader === 'string' && rawHeader.trim().length > 0
      ? rawHeader
      : null;
  }

  private stripBearerPrefix(token: string): string {
    return token
      .trim()
      .replace(/^Bearer(?:\s+|$)/i, '')
      .trim();
  }
}
