import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { JwtService } from '@nestjs/jwt';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { Server as IoServer, Socket as ServerSocket } from 'socket.io';
import { io as connectSocket, Socket as ClientSocket } from 'socket.io-client';
import { Socket } from 'socket.io';
import { WsJwtGuard } from './ws-jwt.guard';

type ConnectError = Error & {
  data?: {
    code: number;
    message: string;
  };
};

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let jwtService: {
    verify: jest.Mock;
  };

  beforeEach(() => {
    jwtService = {
      verify: jest.fn().mockReturnValue({
        sub: 'user-1',
        sid: 'session-1',
        iat: 1767225600,
        exp: 1767229200,
      }),
    };

    guard = new WsJwtGuard(jwtService as unknown as JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('validates auth.token, strips the Bearer prefix, and stores decoded user data', () => {
    const client = makeSocket({
      handshake: {
        auth: { token: 'Bearer valid.jwt' },
        headers: {},
      },
    });

    const user = guard.validateSocket(client);

    expect(jwtService.verify).toHaveBeenCalledWith('valid.jwt');
    expect(user).toEqual(
      expect.objectContaining({
        sub: 'user-1',
        sid: 'session-1',
      }),
    );
    expect(client.data.user).toEqual(user);
    expect(client.data.walletAddress).toBe('user-1');
  });

  it('validates authorization header tokens when auth.token is absent', () => {
    const client = makeSocket({
      handshake: {
        auth: {},
        headers: { authorization: 'Bearer header.jwt' },
      },
    });

    guard.validateSocket(client);

    expect(jwtService.verify).toHaveBeenCalledWith('header.jwt');
  });

  it('uses the first authorization header when multiple values are present', () => {
    const client = makeSocket({
      handshake: {
        auth: {},
        headers: { authorization: ['Bearer first.jwt', 'Bearer second.jwt'] },
      },
    });

    guard.validateSocket(client);

    expect(jwtService.verify).toHaveBeenCalledWith('first.jwt');
  });

  it('throws when no token is supplied', () => {
    const client = makeSocket({
      handshake: {
        auth: {},
        headers: {},
      },
    });

    expect(() => guard.validateSocket(client)).toThrow(UnauthorizedException);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('throws when the JWT service rejects an expired token', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const client = makeSocket({
      handshake: {
        auth: { token: 'expired.jwt' },
        headers: {},
      },
    });

    expect(() => guard.validateSocket(client)).toThrow(UnauthorizedException);
    expect(client.data.user).toBeUndefined();
  });

  it('throws when the decoded token has no subject', () => {
    jwtService.verify.mockReturnValue({ sid: 'session-1' });
    const client = makeSocket({
      handshake: {
        auth: { token: 'missing-sub.jwt' },
        headers: {},
      },
    });

    expect(() => guard.validateSocket(client)).toThrow(UnauthorizedException);
    expect(client.data.user).toBeUndefined();
  });

  it('activates websocket contexts and attaches the decoded user', () => {
    const client = makeSocket({
      handshake: {
        auth: { token: 'valid.jwt' },
        headers: {},
      },
    });
    const context = {
      switchToWs: () => ({
        getClient: () => client,
      }),
    } as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(client.data.user).toEqual(
      expect.objectContaining({
        sub: 'user-1',
      }),
    );
  });
});

describe('WsJwtGuard with socket.io-client handshakes', () => {
  let guard: WsJwtGuard;
  let jwtService: {
    verify: jest.Mock;
  };
  let httpServer: HttpServer;
  let ioServer: IoServer;
  let serverUrl: string;
  let connectedSockets: ServerSocket[];
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    jwtService = {
      verify: jest.fn().mockReturnValue({
        sub: 'user-1',
        sid: 'session-1',
        iat: 1767225600,
        exp: 1767229200,
      }),
    };
    guard = new WsJwtGuard(jwtService as unknown as JwtService);
    connectedSockets = [];

    httpServer = createServer();
    ioServer = new IoServer(httpServer, {
      cors: { origin: '*' },
    });
    ioServer.use((socket, next) => {
      try {
        guard.validateSocket(socket);
        next();
      } catch {
        const error = new Error('Unauthorized') as ConnectError;
        error.data = {
          code: 4001,
          message: 'Unauthorized',
        };
        next(error);
      }
    });
    ioServer.on('connection', (socket) => {
      connectedSockets.push(socket);
      socket.emit('authenticated', socket.data.user);
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.removeAllListeners();
      client.disconnect();
    }

    await new Promise<void>((resolve) => {
      ioServer.close(() => resolve());
    });

    if (httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  });

  it('accepts a socket.io-client connection with a valid auth token', async () => {
    const client = createClient({
      auth: { token: 'valid.jwt' },
    });

    const user = await waitForEvent<Record<string, unknown>>(
      client,
      'authenticated',
    );

    expect(user).toEqual(
      expect.objectContaining({
        sub: 'user-1',
        sid: 'session-1',
      }),
    );
    expect(jwtService.verify).toHaveBeenCalledWith('valid.jwt');
    expect(connectedSockets).toHaveLength(1);
    expect(connectedSockets[0].data.user).toEqual(user);
  });

  it('accepts a socket.io-client connection with an authorization header token', async () => {
    const client = createClient({
      extraHeaders: {
        authorization: 'Bearer header.jwt',
      },
    });

    await waitForEvent<Record<string, unknown>>(client, 'authenticated');

    expect(jwtService.verify).toHaveBeenCalledWith('header.jwt');
    expect(connectedSockets).toHaveLength(1);
  });

  it('rejects a socket.io-client connection with no token', async () => {
    const client = createClient();

    const error = await waitForEvent<ConnectError>(client, 'connect_error');

    expect(error.message).toBe('Unauthorized');
    expect(error.data).toEqual({
      code: 4001,
      message: 'Unauthorized',
    });
    expect(jwtService.verify).not.toHaveBeenCalled();
    expect(connectedSockets).toHaveLength(0);
  });

  it('rejects a socket.io-client connection with an expired or malformed token', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const client = createClient({
      auth: { token: 'expired.jwt' },
    });

    const error = await waitForEvent<ConnectError>(client, 'connect_error');

    expect(error.message).toBe('Unauthorized');
    expect(error.data).toEqual({
      code: 4001,
      message: 'Unauthorized',
    });
    expect(jwtService.verify).toHaveBeenCalledWith('expired.jwt');
    expect(connectedSockets).toHaveLength(0);
  });

  function createClient(
    options: Partial<Parameters<typeof connectSocket>[1]> = {},
  ): ClientSocket {
    const client = connectSocket(serverUrl, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      ...options,
    });
    clients.push(client);
    return client;
  }
});

type MockSocketOptions = {
  id?: string;
  data?: Record<string, unknown>;
  handshake?: {
    auth?: Record<string, unknown>;
    headers?: Record<string, string | string[] | undefined>;
  };
};

function makeSocket(overrides: MockSocketOptions = {}): Socket {
  const handshake = {
    auth: overrides.handshake?.auth ?? {},
    headers: overrides.handshake?.headers ?? {},
  };

  return {
    id: 'socket-1',
    data: {},
    ...overrides,
    handshake,
  } as Socket;
}

function waitForEvent<T>(client: ClientSocket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, 3000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      client.off(event, onEvent);
      client.off('connect_error', onConnectError);
      client.off('disconnect', onDisconnect);
    };

    const onEvent = (payload: T): void => {
      cleanup();
      resolve(payload);
    };

    const onConnectError = (error: Error): void => {
      if (event === 'connect_error') {
        cleanup();
        resolve(error as T);
        return;
      }

      cleanup();
      reject(error);
    };

    const onDisconnect = (reason: string): void => {
      if (event === 'disconnect') {
        cleanup();
        resolve(reason as T);
        return;
      }
    };

    client.once(event, onEvent);
    client.once('connect_error', onConnectError);
    client.once('disconnect', onDisconnect);
  });
}
