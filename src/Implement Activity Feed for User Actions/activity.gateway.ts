import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ActivityResponseDto } from './dto/activity-feed.dto';

@WebSocketGateway({
  namespace: '/activity',
  cors: { origin: '*' },
})
export class ActivityGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ActivityGateway.name);
  // Map userId -> Set of socket IDs
  private userSockets = new Map<string, Set<string>>();

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Remove socket from all user mappings
    this.userSockets.forEach((sockets, userId) => {
      sockets.delete(client.id);
      if (sockets.size === 0) this.userSockets.delete(userId);
    });
  }

  /**
   * Client sends { userId } to register for their activity feed.
   * In production, validate via JWT from handshake instead.
   */
  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { userId } = data;
    if (!userId) return;

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(client.id);
    client.join(`user:${userId}`);
    this.logger.log(`Socket ${client.id} subscribed to user ${userId}`);
  }

  emitToUser(userId: string, activity: ActivityResponseDto) {
    this.server.to(`user:${userId}`).emit('activity', activity);
  }
}
