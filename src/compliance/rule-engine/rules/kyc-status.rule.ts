import { Injectable } from '@nestjs/common';
import {
  ITradeEligibilityRule,
  RuleResult,
  TradeEligibilityContext,
} from '../interfaces/trade-eligibility-rule.interface';
import { KycStatus } from '../../../users/entities/user.entity';

/**
 * Rejects trades from users whose KYC verification is not in VERIFIED state.
 */
@Injectable()
export class KycStatusRule implements ITradeEligibilityRule {
  readonly ruleId = 'KYC_STATUS_CHECK';
  readonly ruleName = 'KYC Status Verification';

  async evaluate(context: TradeEligibilityContext): Promise<RuleResult> {
    const passed = context.kycStatus === KycStatus.VERIFIED;

    return {
      ruleId: this.ruleId,
      ruleName: this.ruleName,
      passed,
      reason: passed
        ? undefined
        : `Trade rejected: KYC status is "${context.kycStatus ?? 'unknown'}". ` +
          `Please complete identity verification before trading.`,
    };
  }
}
