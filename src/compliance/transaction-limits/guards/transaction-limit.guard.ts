import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TransactionLimitsService } from '../transaction-limits.service';
import { LimitScope } from '../entities/transaction-limit.entity';

export const LIMIT_SCOPE_KEY = 'limitScope';

@Injectable()
export class TransactionLimitGuard implements CanActivate {
  private readonly logger = new Logger(TransactionLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limitsService: TransactionLimitsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitScope = this.reflector.get<LimitScope>(
      LIMIT_SCOPE_KEY,
      context.getHandler(),
    );

    if (!limitScope) {
      return true; // No limit check required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const body = request.body;

    if (!user || !user.id) {
      throw new BadRequestException('User not authenticated');
    }

    const amount = body.amount || body.value || '0';
    const currency = body.currency || 'USD';
    const userTier = user.tier || 'basic';
    const region = user.region;

    const result = await this.limitsService.checkLimit(
      user.id,
      amount,
      currency,
      limitScope,
      userTier,
      region,
    );

    if (!result.allowed) {
      this.logger.warn(
        `Transaction limit exceeded for user ${user.id}: ${result.message}`,
      );
      throw new BadRequestException(
        result.message || 'Transaction limit exceeded',
      );
    }

    return true;
  }
}
