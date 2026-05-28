import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { SessionManagerService } from '../session/session-manager.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let sessionManager: jest.Mocked<Pick<SessionManagerService, 'getSession'>>;

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    };
    usersService = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        username: 'alice',
        walletAddress: 'GPUBKEY',
        isActive: true,
      }),
    };
    sessionManager = {
      getSession: jest.fn().mockResolvedValue({
        userId: 'user-1',
        publicKey: 'GPUBKEY',
        createdAt: 100,
        lastActivity: 200,
      }),
    };

    strategy = new JwtStrategy(
      configService as unknown as ConfigService,
      usersService as unknown as UsersService,
      sessionManager as unknown as SessionManagerService,
    );
  });

  it('accepts an active user token only when the session still exists', async () => {
    await expect(
      strategy.validate({ sub: 'user-1', sid: 'sess-1' }),
    ).resolves.toEqual({
      id: 'user-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      username: 'alice',
      walletAddress: 'GPUBKEY',
    });

    expect(sessionManager.getSession).toHaveBeenCalledWith('sess-1');
    expect(usersService.findById).toHaveBeenCalledWith('user-1');
  });

  it('rejects a token for an invalidated session before loading the user', async () => {
    sessionManager.getSession.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'user-1', sid: 'revoked-session' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('rejects a token whose session belongs to a different user', async () => {
    sessionManager.getSession.mockResolvedValue({
      userId: 'other-user',
      publicKey: 'GPUBKEY',
      createdAt: 100,
      lastActivity: 200,
    });

    await expect(
      strategy.validate({ sub: 'user-1', sid: 'sess-1' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('continues to accept legacy user tokens that are not session-bound', async () => {
    await expect(strategy.validate({ sub: 'user-1' })).resolves.toEqual({
      id: 'user-1',
      userId: 'user-1',
      username: 'alice',
      walletAddress: 'GPUBKEY',
    });

    expect(sessionManager.getSession).not.toHaveBeenCalled();
    expect(usersService.findById).toHaveBeenCalledWith('user-1');
  });
});
