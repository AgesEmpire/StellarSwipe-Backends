import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { WsJwtAuthGuard } from '../../auth/guards/ws-jwt-auth.guard';

/**
 * Base class for authenticated WebSocket gateways (#646).
 *
 * Subclass and inject WsJwtAuthGuard:
 *
 *   @WebSocketGateway({ namespace: '/trading' })
 *   export class TradingGateway extends AuthenticatedGateway { ... }
 *
 * All connections are authenticated on connect; unauthenticated clients
 * are immediately disconnected and logged.
 */
export abstract class AuthenticatedGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  protected readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly wsAuthGuard: WsJwtAuthGuard) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      await this.wsAuthGuard.validateSocket(client);
      const user = (client as any).user;
      this.logger.log(`[CONNECT] socket=${client.id} userId=${user?.id}`);
      this.onAuthenticated(client);
    } catch {
      this.logger.warn(`[REJECT] socket=${client.id} — unauthorized`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = (client as any).user;
    this.logger.log(
      `[DISCONNECT] socket=${client.id} userId=${user?.id ?? 'unknown'}`,
    );
    this.onDisconnected(client);
  }

  /** Override to run logic after a socket is authenticated. */
  protected onAuthenticated(_client: Socket): void {}

  /** Override to run cleanup when a client disconnects. */
  protected onDisconnected(_client: Socket): void {}
}
