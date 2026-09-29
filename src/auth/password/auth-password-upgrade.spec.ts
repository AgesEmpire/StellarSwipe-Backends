// Mock collaborators at the module boundary so this suite exercises only
// AuthService's password path, not the dependency graph behind each service.
jest.mock('../../users/users.service', () => ({ UsersService: class {} }));
jest.mock('../auth-audit.service', () => ({ AuthAuditService: class {} }));
jest.mock('../session/session-manager.service', () => ({
  SessionManagerService: class {},
}));
jest.mock('../session/session-fingerprint.service', () => ({
  SessionFingerprintService: class {},
}));
jest.mock('../../email/email.service', () => ({ EmailService: class {} }));
jest.mock('../../audit-log/entities/audit-log.entity', () => ({
  AuditAction: {},
  AuditStatus: {},
}));
// Pass-through mock so tests can assert whether bcrypt was consulted.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return { ...actual, compare: jest.fn(actual.compare) };
});

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { PasswordHasherService } from './password-hasher.service';

const CONFIGURED_ROUNDS = 11;
const PASSWORD = 'password123';

describe('AuthService.validatePassword (hash cost upgrades)', () => {
  let service: AuthService;
  let usersService: {
    findByEmailWithPassword: jest.Mock;
    updatePasswordIfUnchanged: jest.Mock;
    updatePassword: jest.Mock;
  };
  let outdatedHash: string;
  let currentHash: string;

  beforeAll(async () => {
    outdatedHash = await bcrypt.hash(PASSWORD, CONFIGURED_ROUNDS - 1);
    currentHash = await bcrypt.hash(PASSWORD, CONFIGURED_ROUNDS);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    usersService = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(null),
      updatePasswordIfUnchanged: jest.fn().mockResolvedValue(true),
      updatePassword: jest.fn().mockResolvedValue(undefined),
    };
    const hasher = new PasswordHasherService({
      get: () => CONFIGURED_ROUNDS,
    } as unknown as ConfigService);

    service = new AuthService(
      {} as any,
      usersService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      hasher,
    );
  });

  const storedUser = (password: string, overrides: object = {}) => ({
    id: 'user-uuid',
    email: 'test@example.com',
    username: 'testuser',
    isActive: true,
    password,
    ...overrides,
  });

  it('authenticates a current hash without rewriting it', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(
      storedUser(currentHash),
    );

    const user = await service.validatePassword('test@example.com', PASSWORD);

    expect(user.id).toBe('user-uuid');
    expect(user.password).toBeUndefined();
    expect(usersService.updatePasswordIfUnchanged).not.toHaveBeenCalled();
    expect(usersService.updatePassword).not.toHaveBeenCalled();
  });

  it('upgrades an outdated hash with a compare-and-set write', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(
      storedUser(outdatedHash),
    );

    await service.validatePassword('test@example.com', PASSWORD);

    expect(usersService.updatePasswordIfUnchanged).toHaveBeenCalledWith(
      'user-uuid',
      outdatedHash,
      expect.any(String),
    );
    const upgradedHash = usersService.updatePasswordIfUnchanged.mock.calls[0][2];
    expect(bcrypt.getRounds(upgradedHash)).toBe(CONFIGURED_ROUNDS);
    await expect(bcrypt.compare(PASSWORD, upgradedHash)).resolves.toBe(true);
    expect(usersService.updatePassword).not.toHaveBeenCalled();
  });

  it('still authenticates when persisting the upgraded hash fails', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(
      storedUser(outdatedHash),
    );
    usersService.updatePasswordIfUnchanged.mockRejectedValue(
      new Error('db down'),
    );

    await expect(
      service.validatePassword('test@example.com', PASSWORD),
    ).resolves.toEqual(expect.objectContaining({ id: 'user-uuid' }));
  });

  it('rejects a wrong password and leaves the outdated hash untouched', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(
      storedUser(outdatedHash),
    );

    await expect(
      service.validatePassword('test@example.com', 'wrong-password'),
    ).rejects.toThrow(UnauthorizedException);
    expect(usersService.updatePasswordIfUnchanged).not.toHaveBeenCalled();
  });

  it('rejects an unknown email with the same error as a wrong password', async () => {
    await expect(
      service.validatePassword('nobody@example.com', PASSWORD),
    ).rejects.toThrow('Invalid email or password');
  });

  it('rejects an inactive account without verifying the password', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(
      storedUser(outdatedHash, { isActive: false }),
    );

    await expect(
      service.validatePassword('test@example.com', PASSWORD),
    ).rejects.toThrow(UnauthorizedException);
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(usersService.updatePasswordIfUnchanged).not.toHaveBeenCalled();
  });

  it('falls back to the default cost when no hasher is injected', () => {
    const fallback = new AuthService(
      {} as any,
      usersService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    expect((fallback as any).passwordHasher.rounds).toBe(10);
  });
});
