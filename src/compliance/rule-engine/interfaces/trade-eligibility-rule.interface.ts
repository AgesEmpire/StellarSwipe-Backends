/**
 * Context passed to every compliance rule when evaluating a trade.
 */
export interface TradeEligibilityContext {
  /** The user attempting the trade */
  userId: string;
  /** Trade amount in the base asset */
  amount: number;
  /** Base asset symbol (e.g. 'XLM') */
  asset: string;
  /** Counter asset symbol (e.g. 'USDC') */
  counterAsset?: string;
  /** ISO-3166-1 alpha-2 country code derived from the user's IP */
  countryCode?: string;
  /** Raw IP address of the request */
  ipAddress?: string;
  /** KYC status of the user */
  kycStatus?: string;
  /** User account tier */
  userTier?: string;
  /** Whether the user has any open AML flags */
  hasAmlFlags?: boolean;
  /** Arbitrary extra metadata rules may inspect */
  metadata?: Record<string, unknown>;
}

/**
 * Result returned by a single compliance rule.
 */
export interface RuleResult {
  /** Unique identifier for the rule (e.g. 'KYC_STATUS_CHECK') */
  ruleId: string;
  /** Human-readable rule name */
  ruleName: string;
  /** Whether the trade passes this rule */
  passed: boolean;
  /** Reason for rejection (only populated when passed === false) */
  reason?: string;
}

/**
 * Contract that every compliance rule must implement.
 */
export interface ITradeEligibilityRule {
  /** Unique identifier for this rule */
  readonly ruleId: string;
  /** Human-readable name */
  readonly ruleName: string;
  /**
   * Evaluate the rule against the given context.
   * Must never throw — return a failed RuleResult instead.
   */
  evaluate(context: TradeEligibilityContext): Promise<RuleResult>;
}
