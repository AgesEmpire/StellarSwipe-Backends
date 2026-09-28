import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WebauthnService } from './webauthn.service';
import { WebauthnCredential } from './entities/webauthn-credential.entity';
import { UsersService } from '../../users/users.service';
import { SessionManagerService } from '../session/session-manager.service';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

describe('WebauthnService', () => {
  let service: WebauthnService;
  let credentialRepoSpec: any;
  let usersServiceSpec: any;
  let sessionManagerSpec: any;
  let cacheManagerSpec: any;

  const mockCacheStore = new Map<string, string>();
  const mockUser = {
    id: 'user-uuid',
    username: 'testuser',
    displayName: 'Test User',
    walletAddress: 'GTESTWALLETADDRESS',
    isActive: true,
  };

  beforeEach(async () => {
    mockCacheStore.clear();
    jest.clearAllMocks();

    cacheManagerSpec = {
      set: jest.fn().mockImplementation((key, value) => {
        mockCacheStore.set(key, value);
      }),
      get: jest.fn().mockImplementation((key) => mockCacheStore.get(key)),
      del: jest.fn().mockImplementation((key) => mockCacheStore.delete(key)),
    };

    credentialRepoSpec = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) =>
        Promise.resolve({
          id: 'credential-uuid',
          createdAt: new Date(),
          updatedAt: new Date(),
          counter: 0,
          ...data,
        }),
      ),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    usersServiceSpec = {
      findById: jest.fn().mockResolvedValue(mockUser),
      findByUsername: jest.fn().mockResolvedValue(mockUser),
    };

    sessionManagerSpec = {
      issueTokens: jest.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 3600,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebauthnService,
        {
          provide: getRepositoryToken(WebauthnCredential),
          useValue: credentialRepoSpec,
        },
        { provide: UsersService, useValue: usersServiceSpec },
        { provide: SessionManagerService, useValue: sessionManagerSpec },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, fallback?: any) => fallback) },
        },
        { provide: CACHE_MANAGER, useValue: cacheManagerSpec },
      ],
    }).compile();

    service = module.get<WebauthnService>(WebauthnService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('beginRegistration', () => {
    it('generates registration options and stores the challenge', async () => {
      (generateRegistrationOptions as jest.Mock).mockResolvedValue({
        challenge: 'reg-challenge',
        rp: { name: 'StellarSwipe', id: 'localhost' },
      });

      const options = await service.beginRegistration(mockUser.id);

      expect(options.challenge).toBe('reg-challenge');
      expect(cacheManagerSpec.set).toHaveBeenCalledWith(
        `webauthn_reg_challenge:${mockUser.id}`,
        expect.any(String),
        expect.any(Number),
      );
    });

    it('throws if the user already has the maximum number of passkeys', async () => {
      credentialRepoSpec.find.mockResolvedValue(new Array(10).fill({ credentialId: 'x' }));

      await expect(service.beginRegistration(mockUser.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws if the user does not exist', async () => {
      usersServiceSpec.findById.mockResolvedValue(null);

      await expect(service.beginRegistration(mockUser.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('completeRegistration', () => {
    it('persists a new credential on successful verification', async () => {
      mockCacheStore.set(
        `webauthn_reg_challenge:${mockUser.id}`,
        JSON.stringify({ userId: mockUser.id, challenge: 'reg-challenge' }),
      );

      (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred-id-1',
            publicKey: Buffer.from('public-key-bytes'),
            counter: 0,
            transports: ['internal'],
          },
        },
      });

      const result = await service.completeRegistration(mockUser.id, {
        attestationResponse: { id: 'cred-id-1' } as any,
        deviceName: 'MacBook Touch ID',
      });

      expect(result.id).toBe('credential-uuid');
      expect(credentialRepoSpec.save).toHaveBeenCalled();
      expect(cacheManagerSpec.del).toHaveBeenCalledWith(
        `webauthn_reg_challenge:${mockUser.id}`,
      );
      expect(mockCacheStore.has(`webauthn_reg_challenge:${mockUser.id}`)).toBe(false);
    });

    it('throws if the registration challenge has expired', async () => {
      await expect(
        service.completeRegistration(mockUser.id, {
          attestationResponse: { id: 'cred-id-1' } as any,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws if verification fails', async () => {
      mockCacheStore.set(
        `webauthn_reg_challenge:${mockUser.id}`,
        JSON.stringify({ userId: mockUser.id, challenge: 'reg-challenge' }),
      );
      (verifyRegistrationResponse as jest.Mock).mockResolvedValue({ verified: false });

      await expect(
        service.completeRegistration(mockUser.id, {
          attestationResponse: { id: 'cred-id-1' } as any,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws if the credential is already registered', async () => {
      mockCacheStore.set(
        `webauthn_reg_challenge:${mockUser.id}`,
        JSON.stringify({ userId: mockUser.id, challenge: 'reg-challenge' }),
      );
      (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'cred-id-1',
            publicKey: Buffer.from('public-key-bytes'),
            counter: 0,
          },
        },
      });
      credentialRepoSpec.findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.completeRegistration(mockUser.id, {
          attestationResponse: { id: 'cred-id-1' } as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('beginLogin', () => {
    it('generates discoverable login options when no username is provided', async () => {
      (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
        challenge: 'login-challenge',
      });

      const options = await service.beginLogin({});

      expect(options.challenge).toBe('login-challenge');
      expect(cacheManagerSpec.set).toHaveBeenCalledWith(
        'webauthn_login_challenge:login-challenge',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('scopes allowed credentials when a username is provided', async () => {
      credentialRepoSpec.find.mockResolvedValue([
        { credentialId: 'cred-id-1', transports: ['internal'] },
      ]);
      (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
        challenge: 'login-challenge-scoped',
      });

      await service.beginLogin({ username: 'testuser' });

      expect(generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: [{ id: 'cred-id-1', transports: ['internal'] }],
        }),
      );
    });
  });

  describe('completeLogin', () => {
    const baseClientData = { challenge: 'login-challenge', type: 'webauthn.get' };
    const assertionResponse = {
      id: 'cred-id-1',
      response: {
        clientDataJSON: Buffer.from(JSON.stringify(baseClientData)).toString('base64url'),
      },
    };

    const storedCredential = {
      id: 'credential-uuid',
      userId: mockUser.id,
      credentialId: 'cred-id-1',
      publicKey: Buffer.from('public-key-bytes').toString('base64url'),
      counter: 0,
      transports: ['internal'],
    };

    it('issues tokens on successful assertion verification', async () => {
      credentialRepoSpec.findOne.mockResolvedValue({ ...storedCredential });
      mockCacheStore.set(
        'webauthn_login_challenge:login-challenge',
        JSON.stringify({ challenge: 'login-challenge', userId: mockUser.id }),
      );
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });

      const result = await service.completeLogin({ assertionResponse: assertionResponse as any });

      expect(result.accessToken).toBe('mock-access-token');
      expect(sessionManagerSpec.issueTokens).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.walletAddress,
        expect.objectContaining({ method: 'webauthn' }),
      );
      expect(credentialRepoSpec.save).toHaveBeenCalledWith(
        expect.objectContaining({ counter: 1 }),
      );
    });

    it('rejects an unrecognized credential id', async () => {
      credentialRepoSpec.findOne.mockResolvedValue(null);

      await expect(
        service.completeLogin({ assertionResponse: assertionResponse as any }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the login challenge has expired', async () => {
      credentialRepoSpec.findOne.mockResolvedValue({ ...storedCredential });

      await expect(
        service.completeLogin({ assertionResponse: assertionResponse as any }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an invalid assertion', async () => {
      credentialRepoSpec.findOne.mockResolvedValue({ ...storedCredential });
      mockCacheStore.set(
        'webauthn_login_challenge:login-challenge',
        JSON.stringify({ challenge: 'login-challenge', userId: mockUser.id }),
      );
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({ verified: false });

      await expect(
        service.completeLogin({ assertionResponse: assertionResponse as any }),
      ).rejects.toThrow(UnauthorizedException);
      expect(sessionManagerSpec.issueTokens).not.toHaveBeenCalled();
    });

    it('rejects when verification throws', async () => {
      credentialRepoSpec.findOne.mockResolvedValue({ ...storedCredential });
      mockCacheStore.set(
        'webauthn_login_challenge:login-challenge',
        JSON.stringify({ challenge: 'login-challenge', userId: mockUser.id }),
      );
      (verifyAuthenticationResponse as jest.Mock).mockRejectedValue(new Error('bad signature'));

      await expect(
        service.completeLogin({ assertionResponse: assertionResponse as any }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('listCredentials', () => {
    it('returns credentials for the user', async () => {
      credentialRepoSpec.find.mockResolvedValue([{ id: 'credential-uuid' }]);

      const result = await service.listCredentials(mockUser.id);

      expect(result).toHaveLength(1);
      expect(credentialRepoSpec.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: mockUser.id } }),
      );
    });
  });

  describe('removeCredential', () => {
    it('removes an existing credential', async () => {
      credentialRepoSpec.findOne.mockResolvedValue({ id: 'credential-uuid', userId: mockUser.id });

      await service.removeCredential(mockUser.id, 'credential-uuid');

      expect(credentialRepoSpec.remove).toHaveBeenCalled();
    });

    it('throws if the credential does not belong to the user', async () => {
      credentialRepoSpec.findOne.mockResolvedValue(null);

      await expect(
        service.removeCredential(mockUser.id, 'credential-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
