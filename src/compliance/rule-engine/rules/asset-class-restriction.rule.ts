import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ITradeEligibilityRule,
  RuleResult,
  TradeEligibilityContext,
} from '../interfaces/trade-eligibility-rule.interface';

/**
 * Rejects trades involving assets that are restricted on this platform.
 * The restricted asset list is loaded from the RESTRICTED_ASSETS environment
 * variable (comma-separated symbols) and falls back to a sensible default.
 */
@Injectable()
export class AssetClassRestrictionRule implements ITradeEligibilityRule {
  readonly ruleId = 'ASSET_CLASS_RESTRICTION';
  readonly ruleName = 'Asset Class Restriction Check';

  private readonly restrictedAssets: Set<string>;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('RESTRICTED_ASSETS', '');
    this.restrictedAssets = new Set(
      raw
        .split(',')
        .map((a) => a.trim().toUpperCase())
        .filter(Boolean),
    );
  }

  async evaluate(context: TradeEligibilityContext): Promise<RuleResult> {
    const assetsToCheck = [
      context.asset?.toUpperCase(),
      context.counterAsset?.toUpperCase(),
    ].filter(Boolean) as string[];

    const restricted = assetsToCheck.filter((a) =>
      this.restrictedAssets.has(a),
    );

    const passed = restricted.length === 0;

    return {
      ruleId: this.ruleId,
      ruleName: this.ruleName,
      passed,
      reason: passed
        ? undefined
        : `Trade rejected: asset(s) [${restricted.join(', ')}] are restricted ` +
          `on this platform.`,
    };
  }

  /** Expose the current restricted list for admin endpoints. */
  getRestrictedAssets(): string[] {
    return Array.from(this.restrictedAssets);
  }
}
