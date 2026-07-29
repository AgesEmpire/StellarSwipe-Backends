import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthenticatedGateway } from '../common/gateways/authenticated.gateway';
import { WsJwtAuthGuard } from '../auth/guards/ws-jwt-auth.guard';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/dashboard' })
export class DashboardGateway extends AuthenticatedGateway {
  @WebSocketServer()
  server!: Server;

  constructor(
    wsAuthGuard: WsJwtAuthGuard,
    private readonly dashboardService: DashboardService,
  ) {
    super(wsAuthGuard);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const requestingUser = (client as any).user;
    // Users may only subscribe to their own room
    const targetUserId = requestingUser?.id ?? data.userId;
    await client.join(`user_${targetUserId}`);
    const dashboardData =
      await this.dashboardService.getDashboardData(targetUserId);
    client.emit('dashboard_update', dashboardData);
  }

  @UseGuards(WsJwtAuthGuard)
  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const targetUserId = (client as any).user?.id ?? data.userId;
    await client.leave(`user_${targetUserId}`);
  }

  async broadcastUpdate(userId: string): Promise<void> {
    try {
      await this.dashboardService.invalidateCache(userId);
      const dashboardData =
        await this.dashboardService.getDashboardData(userId);
      this.server.to(`user_${userId}`).emit('dashboard_update', dashboardData);
    } catch (error) {
      this.logger.error('Error broadcasting dashboard update:', error);
    }
  }
}
