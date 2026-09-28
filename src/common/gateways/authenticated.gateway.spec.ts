import { Test, TestingModule } from '@nestjs/testing';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthenticatedGateway } from './authenticated.gateway';
import { WsJwtAuthGuard } from '../../auth/guards/ws-jwt-auth.guard';
import { UnauthorizedException } from '@nestjs/common';

// Minimal concrete gateway for testing
@WebSocketGateway({ namespace: '/test' })
class TestGateway extends AuthenticatedGateway {
  @WebSocketServer() server!: Server;
  connected = false;
  disconnected = false;

  protected onAuthenticated(): void {
    this.connected = true;
  }
  protected onDisconnected(): void {
    this.disconnected = true;
  }
}

const makeSocket = (override?: Partial<Socket>): Socket =>
  ({
    id: 'socket-1',
    handshake: { auth: { token: 'Bearer valid.jwt' }, headers: {} },
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...override,
  }) as unknown as Socket;

describe('AuthenticatedGateway (#646)', () => {
  let gateway: TestGateway;
  let guard: jest.Mocked<WsJwtAuthGuard>;

  beforeEach(async () => {
    guard = { validateSocket: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [TestGateway, { provide: WsJwtAuthGuard, useValue: guard }],
    }).compile();

    gateway = module.get(TestGateway);
  });

  it('allows an authorized socket to connect', async () => {
    guard.validateSocket.mockResolvedValue(true);
    const client = makeSocket();
    await gateway.handleConnection(client);
    expect(gateway.connected).toBe(true);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('rejects and disconnects an unauthorized socket', async () => {
    guard.validateSocket.mockRejectedValue(new UnauthorizedException());
    const client = makeSocket();
    await gateway.handleConnection(client);
    expect(client.emit).toHaveBeenCalledWith('error', {
      message: 'Unauthorized',
    });
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(gateway.connected).toBe(false);
  });

  it('logs disconnection events', () => {
    const client = makeSocket();
    (client as any).user = { id: 'user-1' };
    gateway.handleDisconnect(client);
    expect(gateway.disconnected).toBe(true);
  });
});
