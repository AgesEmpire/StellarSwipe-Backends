import { Injectable } from '@nestjs/common';
import {
  ITradeEligibilityRule,
  RuleResult,
  TradeEligibilityContext,
} from '../interfaces/trade-eligibility-rule.interface';

/**
 * Rejects trades for users who have open AML flags or whose trade amount
 * exceeds the hard AML threshold (used as a last-resort circuit-breaker when
 * real-time AML scanning is unavailable).
 */
@Injectable()
export class AmlStatusRule implements ITradeEligibilityRule {
  readonly ruleId = 'AML_STATUS_CHECK';
  readonly ruleName = 'AML / Sanctions Status Check';

  /** Hard threshold above which any single trade is flagged for AML review. */
  private static readonly HARD_AMOUNT_THRESHOLD = 1_000_000;

  async evaluate(context: TradeEligibilityContext): Promise<RuleResult> {
    if (context.hasAmlFlags) {
      return {
        ruleId: this.ruleId,
        ruleName: this.ruleName,
        passed: false,
        reason:
          'Trade rejected: account has open AML flags. ' +
          'Our compliance team will review your account.',
      };
    }

    if (context.amount > AmlStatusRule.HARD_AMOUNT_THRESHOLD) {
      return {
        ruleId: this.ruleId,
        ruleName: this.ruleName,
        passed: false,
        reason:
          `Trade rejected: single-trade amount of ${context.amount} exceeds ` +
          `the AML review threshold of ${AmlStatusRule.HARD_AMOUNT_THRESHOLD}. ` +
          `Please contact support to proceed.`,
      };
    }

    return { ruleId: this.ruleId, ruleName: this.ruleName, passed: true };
  }
}
