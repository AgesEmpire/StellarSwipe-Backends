import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Server, Socket } from 'socket.io';
import { SocketRoom } from './dto/socket-event.dto';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { SocketManagerService } from './services/socket-manager.service';
import { WebsocketGateway } from './websocket.gateway';

describe('WebsocketGateway', () => {
  let gateway: WebsocketGateway;
  let wsJwtGuard: {
    validateSocket: jest.Mock;
  };
  let socketManager: {
    setServer: jest.Mock;
    getUserRoom: jest.Mock;
    registerClient: jest.Mock;
    unregisterClient: jest.Mock;
  };

  beforeEach(() => {
    wsJwtGuard = {
      validateSocket: jest.fn().mockReturnValue({
        sub: 'user-1',
        sid: 'session-1',
      }),
    };

    socketManager = {
      setServer: jest.fn(),
      getUserRoom: jest.fn((userId: string) => `user:${userId}`),
      registerClient: jest.fn(),
      unregisterClient: jest.fn(),
    };

    gateway = new WebsocketGateway(
      wsJwtGuard as unknown as WsJwtGuard,
      socketManager as unknown as SocketManagerService,
    );
    jest
      .spyOn((gateway as any).logger, 'log')
      .mockImplementation(() => undefined);
    jest
      .spyOn((gateway as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('applies the websocket JWT guard at gateway class level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, WebsocketGateway);

    expect(guards).toContain(WsJwtGuard);
  });

  it('registers the socket server with the socket manager after init', () => {
    const server = {
      to: jest.fn(),
    } as unknown as Server;

    gateway.afterInit(server);

    expect(socketManager.setServer).toHaveBeenCalledWith(server);
  });

  it('validates a socket before joining rooms and registering the client', async () => {
    const client = makeSocket();

    await gateway.handleConnection(client);

    expect(wsJwtGuard.validateSocket).toHaveBeenCalledWith(client);
    expect(socketManager.getUserRoom).toHaveBeenCalledWith('user-1');
    expect(client.join).toHaveBeenNthCalledWith(1, 'user:user-1');
    expect(client.join).toHaveBeenNthCalledWith(2, SocketRoom.SIGNALS_FEED);
    expect(client.join).toHaveBeenNthCalledWith(
      3,
      SocketRoom.LEADERBOARD_TOP100,
    );
    expect(socketManager.registerClient).toHaveBeenCalledWith(client);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.rawClose).not.toHaveBeenCalled();
  });

  it('closes unauthorized sockets with 4001 before any room joins or events', async () => {
    const client = makeSocket();
    wsJwtGuard.validateSocket.mockImplementation(() => {
      throw new UnauthorizedException('Invalid token');
    });

    await gateway.handleConnection(client);

    expect(client.rawClose).toHaveBeenCalledWith(4001, 'Unauthorized');
    expect(client.join).not.toHaveBeenCalled();
    expect(socketManager.registerClient).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('falls back to Socket.IO disconnect when the raw websocket is unavailable', async () => {
    const client = makeSocket({ rawCloseAvailable: false });
    wsJwtGuard.validateSocket.mockImplementation(() => {
      throw new UnauthorizedException('Missing token');
    });

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
    expect(socketManager.registerClient).not.toHaveBeenCalled();
  });

  it('unregisters sockets on disconnect', () => {
    const client = makeSocket();

    gateway.handleDisconnect(client);

    expect(socketManager.unregisterClient).toHaveBeenCalledWith(client);
  });

  it('allows subscriptions only to known rooms after gateway-level auth passes', async () => {
    const client = makeSocket();

    await gateway.handleSubscribe(client, { room: SocketRoom.SIGNALS_FEED });
    await gateway.handleSubscribe(client, {
      room: 'unknown-room' as SocketRoom,
    });

    expect(client.join).toHaveBeenCalledTimes(1);
    expect(client.join).toHaveBeenCalledWith(SocketRoom.SIGNALS_FEED);
  });

  it('allows unsubscriptions only from known rooms after gateway-level auth passes', async () => {
    const client = makeSocket();

    await gateway.handleUnsubscribe(client, {
      room: SocketRoom.LEADERBOARD_TOP100,
    });
    await gateway.handleUnsubscribe(client, {
      room: 'unknown-room' as SocketRoom,
    });

    expect(client.leave).toHaveBeenCalledTimes(1);
    expect(client.leave).toHaveBeenCalledWith(SocketRoom.LEADERBOARD_TOP100);
  });

  it('emits user-scoped events through the socket manager user room', () => {
    const emit = jest.fn();
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit }),
    } as unknown as Server;

    gateway.emitToUser('user-1', 'trade:updated', { tradeId: 'trade-1' });

    expect(socketManager.getUserRoom).toHaveBeenCalledWith('user-1');
    expect(gateway.server.to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith('trade:updated', { tradeId: 'trade-1' });
  });
});

type MockSocket = Socket & {
  rawClose: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
  disconnect: jest.Mock;
  emit: jest.Mock;
};

function makeSocket(options: { rawCloseAvailable?: boolean } = {}): MockSocket {
  const rawClose = jest.fn();
  const transport =
    options.rawCloseAvailable === false
      ? {}
      : {
          socket: {
            close: rawClose,
          },
        };

  return {
    id: 'socket-1',
    data: {},
    conn: {
      transport,
    },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
    rawClose,
  } as unknown as MockSocket;
}
