import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KycService } from './kyc.service';
import { KycLevel } from './entities/kyc-verification.entity';

/** Decorator: require a minimum KYC level on a route */
export const REQUIRE_KYC_LEVEL_KEY = 'requireKycLevel';
export const RequireKycLevel = (level: KycLevel) =>
  Reflect.metadata(REQUIRE_KYC_LEVEL_KEY, level);

/** Decorator: require KYC check for a specific USD amount */
export const REQUIRE_KYC_AMOUNT_KEY = 'requireKycAmount';
export const RequireKycAmount = (amountUsd: number) =>
  Reflect.metadata(REQUIRE_KYC_AMOUNT_KEY, amountUsd);

@Injectable()
export class KycGuard implements CanActivate {
  private readonly logger = new Logger(KycGuard.name);

  constructor(
    private readonly kycService: KycService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredLevel = this.reflector.getAllAndOverride<
      KycLevel | undefined
    >(REQUIRE_KYC_LEVEL_KEY, [context.getHandler(), context.getClass()]);

    const requiredAmount = this.reflector.getAllAndOverride<number | undefined>(
      REQUIRE_KYC_AMOUNT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No KYC requirement on this route
    if (requiredLevel === undefined && requiredAmount === undefined)
      return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId) return true; // Let auth guard handle unauthenticated users

    const activeLevel = await this.kycService.getActiveKycLevel(userId);

    // Enforce minimum KYC level
    if (requiredLevel !== undefined && activeLevel < requiredLevel) {
      throw new ForbiddenException(
        `This action requires KYC Level ${requiredLevel}. Your current level is ${activeLevel}. ` +
          `Please complete identity verification to proceed.`,
      );
    }

    // Enforce amount-based limit check
    if (requiredAmount !== undefined) {
      await this.kycService.checkMonthlyLimit(userId, requiredAmount);
    }

    return true;
  }
}
