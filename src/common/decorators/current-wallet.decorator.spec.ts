import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { currentWalletFactory } from './current-wallet.decorator';

/**
 * Builds a minimal HTTP {@link ExecutionContext} whose request carries the
 * provided `user` object.
 */
function httpContext(user: unknown): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('CurrentWallet decorator (currentWalletFactory)', () => {
  describe('present-wallet cases', () => {
    it('returns the wallet from user.walletAddress', () => {
      const ctx = httpContext({ walletAddress: 'GABC...XYZ' });
      expect(currentWalletFactory(undefined, ctx)).toBe('GABC...XYZ');
    });

    it('falls back to user.publicKey when walletAddress is absent', () => {
      const ctx = httpContext({ publicKey: 'GPUBLIC...KEY' });
      expect(currentWalletFactory(undefined, ctx)).toBe('GPUBLIC...KEY');
    });

    it('prefers walletAddress over publicKey when both are present', () => {
      const ctx = httpContext({
        walletAddress: 'GWALLET...ADDR',
        publicKey: 'GPUBLIC...KEY',
      });
      expect(currentWalletFactory(undefined, ctx)).toBe('GWALLET...ADDR');
    });
  });

  describe('missing-wallet cases', () => {
    it('throws UnauthorizedException when there is no user', () => {
      const ctx = httpContext(undefined);
      expect(() => currentWalletFactory(undefined, ctx)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the wallet is an empty string', () => {
      const ctx = httpContext({ walletAddress: '' });
      expect(() => currentWalletFactory(undefined, ctx)).toThrow(
        UnauthorizedException,
      );
    });

    it('returns undefined (no throw) when optional is true', () => {
      const ctx = httpContext({});
      expect(currentWalletFactory({ optional: true }, ctx)).toBeUndefined();
    });
  });
});
