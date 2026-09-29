export enum KycLevel {
  NONE = 0,
  BASIC = 1,
  INTERMEDIATE = 2,
  ADVANCED = 3,
}

export interface TradingLimits {
  dailyWithdrawal: number;
  dailyTrading: number;
  maxOrderSize: number;
}

export const KYC_LEVEL_LIMITS: Record<KycLevel, TradingLimits> = {
  [KycLevel.NONE]: { dailyWithdrawal: 0, dailyTrading: 0, maxOrderSize: 0 },
  [KycLevel.BASIC]: {
    dailyWithdrawal: 1_000,
    dailyTrading: 10_000,
    maxOrderSize: 1_000,
  },
  [KycLevel.INTERMEDIATE]: {
    dailyWithdrawal: 10_000,
    dailyTrading: 100_000,
    maxOrderSize: 10_000,
  },
  [KycLevel.ADVANCED]: {
    dailyWithdrawal: 100_000,
    dailyTrading: 1_000_000,
    maxOrderSize: 100_000,
  },
};

export function isValidKycLevel(level: unknown): level is KycLevel {
  return (
    typeof level === 'number' &&
    Number.isInteger(level) &&
    level in KYC_LEVEL_LIMITS
  );
}

export function limitsForLevel(level: KycLevel): TradingLimits {
  return { ...KYC_LEVEL_LIMITS[level] };
}

export class Kyc {
  level: KycLevel = KycLevel.NONE;
  limits: TradingLimits = limitsForLevel(KycLevel.NONE);

  /**
   * Applies a KYC approval event to this record.
   *
   * Only monotonic upgrades to a valid, higher level are applied so that
   * stale or out-of-order events can never increase existing limits.
   * Duplicate approvals for the current level are idempotent no-ops.
   * Downgrades and unknown levels are rejected.
   *
   * @returns true when the level and limits were changed, false otherwise.
   */
  applyApproval(level: KycLevel): boolean {
    if (!isValidKycLevel(level)) {
      return false;
    }
    if (level <= this.level) {
      return false;
    }
    this.level = level;
    this.limits = limitsForLevel(level);
    return true;
  }
}
