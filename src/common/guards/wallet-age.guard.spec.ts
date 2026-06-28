import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { WalletAgeGuard, MIN_WALLET_AGE_KEY } from './wallet-age.guard';
import { WalletAgeService } from './wallet-age.service';

const PUBLIC_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

function makeContext(
  publicKey: string | undefined,
  metadataValue: number | undefined,
): ExecutionContext {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(metadataValue),
  } as unknown as Reflector;

  const request = {
    user: publicKey ? { walletAddress: publicKey } : {},
    body: {},
  };

  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
    __reflector: reflector,
  } as unknown as ExecutionContext;
}

describe('WalletAgeGuard', () => {
  let guard: WalletAgeGuard;
  let walletAgeService: jest.Mocked<WalletAgeService>;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    walletAgeService = {
      isOldEnough: jest.fn(),
      getAccountCreatedAt: jest.fn(),
    } as any;

    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletAgeGuard,
        { provide: WalletAgeService, useValue: walletAgeService },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();

    guard = module.get(WalletAgeGuard);
  });

  function buildContext(publicKey?: string): ExecutionContext {
    const request = {
      user: publicKey ? { walletAddress: publicKey } : {},
      body: {},
    };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('passes when no @MinWalletAge metadata is set', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const result = await guard.canActivate(buildContext(PUBLIC_KEY));
    expect(result).toBe(true);
    expect(walletAgeService.isOldEnough).not.toHaveBeenCalled();
  });

  it('passes when no public key on request and metadata is set (delegates to auth guard)', async () => {
    reflector.getAllAndOverride.mockReturnValue(30);
    const result = await guard.canActivate(buildContext(undefined));
    expect(result).toBe(true);
    expect(walletAgeService.isOldEnough).not.toHaveBeenCalled();
  });

  it('passes when account age is exactly at the threshold', async () => {
    reflector.getAllAndOverride.mockReturnValue(30);
    walletAgeService.isOldEnough.mockResolvedValue(true);

    const result = await guard.canActivate(buildContext(PUBLIC_KEY));
    expect(result).toBe(true);
    expect(walletAgeService.isOldEnough).toHaveBeenCalledWith(PUBLIC_KEY, 30);
  });

  it('passes when account age is above the threshold', async () => {
    reflector.getAllAndOverride.mockReturnValue(7);
    walletAgeService.isOldEnough.mockResolvedValue(true);

    const result = await guard.canActivate(buildContext(PUBLIC_KEY));
    expect(result).toBe(true);
  });

  it('throws ForbiddenException with WALLET_TOO_YOUNG when account is too new', async () => {
    reflector.getAllAndOverride.mockReturnValue(30);
    walletAgeService.isOldEnough.mockResolvedValue(false);

    await expect(guard.canActivate(buildContext(PUBLIC_KEY))).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(buildContext(PUBLIC_KEY));
    } catch (err: any) {
      expect(err.response.errorCode).toBe('WALLET_TOO_YOUNG');
    }
  });

  it('throws ForbiddenException with WALLET_AGE_CHECK_FAILED when Horizon call fails', async () => {
    reflector.getAllAndOverride.mockReturnValue(30);
    walletAgeService.isOldEnough.mockRejectedValue(new Error('Network error'));

    await expect(guard.canActivate(buildContext(PUBLIC_KEY))).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(buildContext(PUBLIC_KEY));
    } catch (err: any) {
      expect(err.response.errorCode).toBe('WALLET_AGE_CHECK_FAILED');
    }
  });
});
