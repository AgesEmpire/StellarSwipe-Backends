import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WalletNetworkGuard } from './wallet-network.guard';
import { WalletNetworkDetectorService } from '../services/wallet-network-detector.service';
import {
  WalletNetworkRequirement,
  WALLET_NETWORK_REQUIREMENT_KEY,
} from '../decorators/wallet-network-requirement.decorator';
import { WalletNetworkMismatchException } from '../exceptions/wallet-network-mismatch.exception';

describe('WalletNetworkGuard', () => {
  let guard: WalletNetworkGuard;
  let reflector: Reflector;
  let detector: WalletNetworkDetectorService;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    detector = {
      extractNetworkFromUser: jest.fn(),
      isNetworkAllowed: jest.fn(),
    } as any;

    guard = new WalletNetworkGuard(reflector, detector);
  });

  describe('canActivate', () => {
    it('returns true when no network requirement is set', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
      } as any;

      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows request when network matches requirement', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(
        WalletNetworkRequirement.MAINNET,
      );

      (detector.extractNetworkFromUser as jest.Mock).mockReturnValue(
        WalletNetworkRequirement.MAINNET,
      );

      (detector.isNetworkAllowed as jest.Mock).mockReturnValue(true);

      const request = {
        user: { network: 'mainnet' },
      };

      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => request }),
      } as any;

      expect(guard.canActivate(context)).toBe(true);
    });

    it('throws WalletNetworkMismatchException when network mismatches', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(
        WalletNetworkRequirement.MAINNET,
      );

      (detector.extractNetworkFromUser as jest.Mock).mockReturnValue(
        WalletNetworkRequirement.TESTNET,
      );

      (detector.isNetworkAllowed as jest.Mock).mockReturnValue(false);

      const request = {
        user: { network: 'testnet' },
      };

      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => request }),
      } as any;

      expect(() => guard.canActivate(context)).toThrow(
        WalletNetworkMismatchException,
      );
    });

    it('allows EITHER requirement for any network', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(
        WalletNetworkRequirement.EITHER,
      );

      (detector.extractNetworkFromUser as jest.Mock).mockReturnValue(
        WalletNetworkRequirement.TESTNET,
      );

      (detector.isNetworkAllowed as jest.Mock).mockReturnValue(true);

      const request = {
        user: { network: 'testnet' },
      };

      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => request }),
      } as any;

      expect(guard.canActivate(context)).toBe(true);
    });

    it('handles missing user object', () => {
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(
        WalletNetworkRequirement.MAINNET,
      );

      (detector.extractNetworkFromUser as jest.Mock).mockReturnValue(undefined);
      (detector.isNetworkAllowed as jest.Mock).mockReturnValue(false);

      const request = {};

      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => request }),
      } as any;

      expect(() => guard.canActivate(context)).toThrow(
        WalletNetworkMismatchException,
      );
    });
  });
});
