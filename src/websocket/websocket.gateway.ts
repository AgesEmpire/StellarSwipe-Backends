import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SocketManagerService } from './services/socket-manager.service';
import { RoomSubscriptionDto, SocketRoom } from './dto/socket-event.dto';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@UseGuards(WsJwtGuard)
@WebSocketGateway({
  cors: {
    origin: '*',
  },
  pingInterval: 30000,
  pingTimeout: 10000,
})
export class WebsocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(WebsocketGateway.name);

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly socketManager: SocketManagerService,
  ) {}

  afterInit(server: Server): void {
    this.socketManager.setServer(server);
  }

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    try {
      const user = await this.wsJwtGuard.validateSocket(client);

      // Issue #1334: enforce API key scopes during the handshake so sockets
      // lacking the required scopes are denied before any event handling.
      if (!this.hasRequiredScopes(user)) {
        this.logger.warn(`Socket scope denied: ${client.id}`);
        this.closeForbidden(client);
        return;
      }

      // Issue #1386: cap concurrent connections per account before the
      // socket is admitted to its account room, so rejected sockets never
      // count toward (or receive) that account's private traffic.
      const withinLimit = await this.socketManager.enforceConnectionLimit(
        user.sub,
        client,
      );
      if (!withinLimit) {
        this.closeConnectionLimitExceeded(client);
        return;
      }

      await client.join(this.socketManager.getUserRoom(user.sub));
      await client.join(SocketRoom.SIGNALS_FEED);
      await client.join(SocketRoom.LEADERBOARD_TOP100);

      this.socketManager.registerClient(client);
      this.logger.log(`Socket connected: ${client.id}`);
    } catch {
      this.logger.warn(`Socket auth failed: ${client.id}`);
      this.closeUnauthorized(client);
    }
  }

  handleDisconnect(@ConnectedSocket() client: Socket): void {
    this.socketManager.unregisterClient(client);
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: RoomSubscriptionDto,
  ): Promise<void> {
    if (!this.isAllowedRoom(body?.room)) {
      return;
    }

    if (!this.isAuthorizedForRoom(client, body.room)) {
      this.logger.warn(
        `Socket ${client.id} not authorized for room ${body.room}`,
      );
      this.closeUnauthorized(client);
      return;
    }

    await client.join(body.room);
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: RoomSubscriptionDto,
  ): Promise<void> {
    if (!this.isAllowedRoom(body?.room)) {
      return;
    }

    await client.leave(body.room);
  }

  private isAllowedRoom(room?: string): room is SocketRoom {
    return Object.values(SocketRoom).includes(room as SocketRoom);
  }

  private isAuthorizedForRoom(client: Socket, room: SocketRoom): boolean {
    try {
      const user = this.wsJwtGuard.validateSocket(client);

      // Issue #1334: protected rooms require the same API key scopes as the
      // equivalent HTTP endpoints before the handler runs.
      if (!this.hasRequiredScopes(user, this.getRequiredScopesForRoom(room))) {
        this.logger.warn(
          `Socket ${client.id} missing scopes for room ${room}`,
        );
        this.closeForbidden(client);
        return false;
      }

      if (room === SocketRoom.SIGNALS_FEED) {
        return true;
      }

      if (room === SocketRoom.LEADERBOARD_TOP100) {
        return true;
      }

      return client.rooms.has(this.socketManager.getUserRoom(user.sub));
    } catch {
      this.logger.warn(`Socket credential invalid: ${client.id}`);
      this.closeUnauthorized(client);
      return false;
    }
  }

  /** Issue #1334: scopes required to open a socket at all. */
  private getRequiredScopesForConnection(): string[] {
    return ['signals:read'];
  }

  /** Issue #1334: scopes required per protected room, mirroring HTTP policy. */
  private getRequiredScopesForRoom(room: SocketRoom): string[] {
    switch (room) {
      case SocketRoom.SIGNALS_FEED:
        return ['signals:read'];
      case SocketRoom.LEADERBOARD_TOP100:
        return ['leaderboard:read'];
      default:
        return [];
    }
  }

  /** Issue #1334: API key scopes are carried on the validated socket user. */
  private hasRequiredScopes(
    user: { scopes?: string[] },
    required: string[] = this.getRequiredScopesForConnection(),
  ): boolean {
    if (required.length === 0) {
      return true;
    }

    const granted = user?.scopes ?? [];
    return required.every((scope) => granted.includes(scope));
  }

  private closeUnauthorized(client: Socket): void {
    this.closeWithCode(client, 4001, 'Unauthorized');
  }

  /** Issue #1334: closed when the API key lacks the required scopes. */
  private closeForbidden(client: Socket): void {
    this.closeWithCode(client, 4003, 'Forbidden');
  }

  /** Issue #1386: closed when the account is already at its concurrent-connection cap. */
  private closeConnectionLimitExceeded(client: Socket): void {
    this.closeWithCode(client, 4008, 'Connection limit exceeded');
  }

  private closeWithCode(client: Socket, code: number, reason: string): void {
    const rawSocket = this.getRawWebSocket(client);
    if (rawSocket?.close) {
      rawSocket.close(code, reason);
      return;
    }

    client.disconnect(true);
  }

  private getRawWebSocket(
    client: Socket,
  ): { close: (code?: number, reason?: string) => void } | null {
    const transport = client.conn?.transport as
      | {
          socket?: { close?: (code?: number, reason?: string) => void };
          ws?: { close?: (code?: number, reason?: string) => void };
        }
      | undefined;
    const socket = transport?.socket ?? transport?.ws;

    return typeof socket?.close === 'function'
      ? { close: socket.close.bind(socket) }
      : null;
  }

  emitToUser(userId: string, event: string, data: any): void {
    const room = this.socketManager.getUserRoom(userId);
    this.server.to(room).emit(event, data);
  }
}
