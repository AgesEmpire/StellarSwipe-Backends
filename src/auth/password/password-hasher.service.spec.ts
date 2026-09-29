// Pass-through mocks so individual tests can force bcrypt failures.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual('bcrypt');
  return {
    ...actual,
    compare: jest.fn(actual.compare),
    hash: jest.fn(actual.hash),
  };
});

import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  DEFAULT_PASSWORD_HASH_ROUNDS,
  PasswordHasherService,
} from './password-hasher.service';

const PASSWORD = 'correct horse battery staple';

function hasherWithRounds(rounds?: number | string): PasswordHasherService {
  const config = {
    get: jest.fn().mockReturnValue(rounds),
  } as unknown as ConfigService;
  return new PasswordHasherService(config);
}

describe('PasswordHasherService', () => {
  let outdatedHash: string;
  let currentHash: string;

  beforeAll(async () => {
    outdatedHash = await bcrypt.hash(PASSWORD, 10);
    currentHash = await bcrypt.hash(PASSWORD, 11);
  });

  afterEach(() => jest.clearAllMocks());

  describe('configuration', () => {
    it('defaults to the legacy cost when PASSWORD_HASH_ROUNDS is unset', () => {
      expect(hasherWithRounds(undefined).rounds).toBe(DEFAULT_PASSWORD_HASH_ROUNDS);
      expect(new PasswordHasherService().rounds).toBe(DEFAULT_PASSWORD_HASH_ROUNDS);
    });

    it('accepts numeric strings from the environment', () => {
      expect(hasherWithRounds('12').rounds).toBe(12);
    });

    it.each([9, 16, 11.5, 'abc'])('rejects out-of-range cost %p', (rounds) => {
      expect(() => hasherWithRounds(rounds)).toThrow(/PASSWORD_HASH_ROUNDS/);
    });
  });

  it('hashes new passwords with the configured cost', async () => {
    const hash = await hasherWithRounds(11).hash(PASSWORD);
    expect(bcrypt.getRounds(hash)).toBe(11);
  });

  describe('needsRehash', () => {
    const hasher = () => hasherWithRounds(11);

    it('flags hashes below the configured cost', () => {
      expect(hasher().needsRehash(outdatedHash)).toBe(true);
    });

    it('leaves hashes at the configured cost alone', () => {
      expect(hasher().needsRehash(currentHash)).toBe(false);
    });

    it('never downgrades hashes above the configured cost', () => {
      expect(hasherWithRounds(10).needsRehash(currentHash)).toBe(false);
    });

    it('ignores unrecognised hash formats', () => {
      expect(hasher().needsRehash('not-a-bcrypt-hash')).toBe(false);
    });
  });

  describe('verifyAndUpgrade', () => {
    it('does not touch a current hash', async () => {
      const persist = jest.fn();
      const result = await hasherWithRounds(11).verifyAndUpgrade(
        PASSWORD,
        currentHash,
        persist,
      );

      expect(result).toEqual({ valid: true, upgraded: false });
      expect(persist).not.toHaveBeenCalled();
    });

    it('upgrades an outdated hash after successful verification', async () => {
      const persist = jest.fn().mockResolvedValue(true);
      const result = await hasherWithRounds(11).verifyAndUpgrade(
        PASSWORD,
        outdatedHash,
        persist,
      );

      expect(result).toEqual({ valid: true, upgraded: true });
      expect(persist).toHaveBeenCalledTimes(1);
      const [previousHash, upgradedHash] = persist.mock.calls[0];
      expect(previousHash).toBe(outdatedHash);
      expect(bcrypt.getRounds(upgradedHash)).toBe(11);
      await expect(bcrypt.compare(PASSWORD, upgradedHash)).resolves.toBe(true);
    });

    it('does not upgrade when the password is wrong', async () => {
      const persist = jest.fn();
      const result = await hasherWithRounds(11).verifyAndUpgrade(
        'wrong password',
        outdatedHash,
        persist,
      );

      expect(result).toEqual({ valid: false, upgraded: false });
      expect(persist).not.toHaveBeenCalled();
    });

    it('rejects a missing stored hash without calling bcrypt', async () => {
      const persist = jest.fn();

      await expect(
        hasherWithRounds(11).verifyAndUpgrade(PASSWORD, undefined, persist),
      ).resolves.toEqual({ valid: false, upgraded: false });
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
    });

    it('treats a verification error as a failed login', async () => {
      (bcrypt.compare as jest.Mock).mockRejectedValueOnce(
        new Error('Invalid salt'),
      );
      const persist = jest.fn();

      await expect(
        hasherWithRounds(11).verifyAndUpgrade(PASSWORD, outdatedHash, persist),
      ).resolves.toEqual({ valid: false, upgraded: false });
      expect(persist).not.toHaveBeenCalled();
    });

    it('still authenticates when persisting the upgraded hash fails', async () => {
      const persist = jest.fn().mockRejectedValue(new Error('db down'));

      await expect(
        hasherWithRounds(11).verifyAndUpgrade(PASSWORD, outdatedHash, persist),
      ).resolves.toEqual({ valid: true, upgraded: false });
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('still authenticates when rehashing fails', async () => {
      (bcrypt.hash as jest.Mock).mockRejectedValueOnce(
        new Error('out of memory'),
      );
      const persist = jest.fn();

      await expect(
        hasherWithRounds(11).verifyAndUpgrade(PASSWORD, outdatedHash, persist),
      ).resolves.toEqual({ valid: true, upgraded: false });
      expect(persist).not.toHaveBeenCalled();
    });

    it('reports no upgrade when the stored hash changed concurrently', async () => {
      const persist = jest.fn().mockResolvedValue(false);

      await expect(
        hasherWithRounds(11).verifyAndUpgrade(PASSWORD, outdatedHash, persist),
      ).resolves.toEqual({ valid: true, upgraded: false });
    });
  });
});
