import { Test, TestingModule } from '@nestjs/testing';
import { SessionManagerService } from './session-manager.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';

describe('SessionManagerService — refresh-token rotation & revocation (#644)', () => {
  let service: SessionManagerService;
  const store = new Map<string, any>();

  const cacheMock = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, val: any) => {
      store.set(key, val);
      return Promise.resolve();
    }),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };

  const jwtServiceMock = {
    sign: jest.fn(() => 'mock.access.token'),
  };

  const configServiceMock = {
    get: jest.fn((key: string, def?: any) => def ?? undefined),
  };

  beforeEach(async () => {
    store.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        { provide: CACHE_MANAGER, useValue: cacheMock },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<SessionManagerService>(SessionManagerService);
  });

  it('issues a token pair and stores the session', async () => {
    const pair = await service.issueTokens('user-1', 'GKEY');
    expect(pair.accessToken).toBe('mock.access.token');
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.expiresIn).toBeGreaterThan(0);
  });

  it('rotates: consuming a refresh token revokes the old session', async () => {
    const { refreshToken } = await service.issueTokens('user-1', 'GKEY');

    // First refresh succeeds and creates a new session
    const rotated = await service.refreshTokens(refreshToken);
    expect(rotated.refreshToken).not.toBe(refreshToken);

    // Second use of the same (now revoked) token must throw
    await expect(service.refreshTokens(refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an invalid refresh token', async () => {
    await expect(
      service.refreshTokens('totally-invalid'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deleteSession removes it so further access is rejected', async () => {
    const { refreshToken } = await service.issueTokens('user-2', 'GKEY2');
    const sessions = await service.getUserSessions('user-2');
    expect(sessions.length).toBe(1);

    await service.deleteSession(sessions[0]);
    const session = await service.getSession(sessions[0]);
    expect(session).toBeNull();
  });

  it('deleteAllUserSessions clears every session (logout-all)', async () => {
    await service.issueTokens('user-3', 'GKEY3');
    await service.issueTokens('user-3', 'GKEY3');

    await service.deleteAllUserSessions('user-3');
    const remaining = await service.getUserSessions('user-3');
    expect(remaining).toHaveLength(0);
  });
});
