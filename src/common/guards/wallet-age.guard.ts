import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WalletAgeService } from './wallet-age.service';

export const MIN_WALLET_AGE_KEY = 'minWalletAgeDays';

/**
 * Apply to a controller method (or class) to require a minimum Stellar wallet
 * account age before the request is processed.
 *
 * @param days Minimum age of the wallet account in days.
 *
 * @example
 * @Post('withdraw')
 * @MinWalletAge(30)
 * withdraw(@Body() dto: WithdrawDto) { ... }
 */
export const MinWalletAge = (days: number) => SetMetadata(MIN_WALLET_AGE_KEY, days);

@Injectable()
export class WalletAgeGuard implements CanActivate {
  private readonly logger = new Logger(WalletAgeGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly walletAgeService: WalletAgeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minimumAgeDays = this.reflector.getAllAndOverride<number | undefined>(
      MIN_WALLET_AGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (minimumAgeDays === undefined) return true;

    const request = context.switchToHttp().getRequest();
    const publicKey: string | undefined =
      request.user?.walletAddress ?? request.user?.publicKey ?? request.body?.walletAddress ?? request.body?.publicKey;

    if (!publicKey) {
      // Let authentication guards handle missing identity; skip age check.
      return true;
    }

    let old: boolean;
    try {
      old = await this.walletAgeService.isOldEnough(publicKey, minimumAgeDays);
    } catch (err) {
      this.logger.warn(`Wallet age check failed for ${publicKey}: ${(err as Error).message}`);
      throw new ForbiddenException({
        errorCode: 'WALLET_AGE_CHECK_FAILED',
        message: 'Unable to verify wallet account age. Ensure the wallet exists on the Stellar network.',
      });
    }

    if (!old) {
      throw new ForbiddenException({
        errorCode: 'WALLET_TOO_YOUNG',
        message: `This action requires a Stellar wallet account at least ${minimumAgeDays} day(s) old.`,
      });
    }

    return true;
  }
}
