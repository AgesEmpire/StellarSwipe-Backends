import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ITradeEligibilityRule,
  RuleResult,
  TradeEligibilityContext,
} from '../interfaces/trade-eligibility-rule.interface';

/**
 * Rejects trades originating from OFAC-sanctioned or otherwise restricted
 * jurisdictions.  The blocked country list is loaded from the
 * BLOCKED_COUNTRIES environment variable (comma-separated ISO-3166-1 alpha-2
 * codes) and falls back to a sensible default.
 */
@Injectable()
export class GeographicRestrictionRule implements ITradeEligibilityRule {
  readonly ruleId = 'GEOGRAPHIC_RESTRICTION';
  readonly ruleName = 'Geographic Restriction Check';

  private readonly blockedCountries: Set<string>;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>(
      'BLOCKED_COUNTRIES',
      'CU,IR,KP,SY,RU,BY,VE,MM,ZW,SD,LY,SO,YE,IQ,LB,AF',
    );
    this.blockedCountries = new Set(
      raw.split(',').map((c) => c.trim().toUpperCase()),
    );
  }

  async evaluate(context: TradeEligibilityContext): Promise<RuleResult> {
    // If no country code is available we allow the trade (fail-open for geo).
    if (!context.countryCode) {
      return { ruleId: this.ruleId, ruleName: this.ruleName, passed: true };
    }

    const code = context.countryCode.toUpperCase();
    const passed = !this.blockedCountries.has(code);

    return {
      ruleId: this.ruleId,
      ruleName: this.ruleName,
      passed,
      reason: passed
        ? undefined
        : `Trade rejected: trading is not permitted from jurisdiction "${code}" ` +
          `due to regulatory restrictions.`,
    };
  }

  /** Expose the current blocked list for admin endpoints. */
  getBlockedCountries(): string[] {
    return Array.from(this.blockedCountries);
  }
}
