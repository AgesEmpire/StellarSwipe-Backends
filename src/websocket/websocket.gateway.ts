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
      const user = this.wsJwtGuard.validateSocket(client);

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

  private closeUnauthorized(client: Socket): void {
    const rawSocket = this.getRawWebSocket(client);
    if (rawSocket?.close) {
      rawSocket.close(4001, 'Unauthorized');
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
