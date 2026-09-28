import { Injectable } from '@nestjs/common';
import {
  ITradeEligibilityRule,
  RuleResult,
  TradeEligibilityContext,
} from '../interfaces/trade-eligibility-rule.interface';
import { UserTier } from '../../../users/entities/user.entity';

/** Per-tier single-trade limits (in base asset units). */
const TIER_LIMITS: Record<string, number> = {
  [UserTier.BASIC]: 1_000,
  [UserTier.SILVER]: 5_000,
  [UserTier.GOLD]: 20_000,
  [UserTier.PLATINUM]: 100_000,
};

/** Default limit applied when the tier is unknown. */
const DEFAULT_LIMIT = 0;

/**
 * Rejects trades whose amount exceeds the per-tier transaction limit.
 */
@Injectable()
export class TransactionLimitRule implements ITradeEligibilityRule {
  readonly ruleId = 'TRANSACTION_LIMIT_CHECK';
  readonly ruleName = 'Transaction Limit Check';

  async evaluate(context: TradeEligibilityContext): Promise<RuleResult> {
    const tier = context.userTier ?? '';
    const limit = TIER_LIMITS[tier] ?? DEFAULT_LIMIT;

    const passed = context.amount <= limit;

    return {
      ruleId: this.ruleId,
      ruleName: this.ruleName,
      passed,
      reason: passed
        ? undefined
        : `Trade rejected: amount ${context.amount} exceeds the ` +
          `${tier || 'unknown'}-tier limit of ${limit}. ` +
          `Upgrade your account tier to trade larger amounts.`,
    };
  }

  /** Expose limits for informational endpoints. */
  getTierLimits(): Record<string, number> {
    return { ...TIER_LIMITS };
  }
}
