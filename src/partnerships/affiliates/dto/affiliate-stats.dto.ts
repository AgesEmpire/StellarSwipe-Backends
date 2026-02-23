export class AffiliateStatsDto {
  totalEarnings: number;
  pendingCommission: number;
  paidCommission: number;
  totalReferrals: number;
  activeReferrals: number;
  conversionRate: number;
  tierBreakdown: {
    tier1: { count: number; earnings: number };
    tier2: { count: number; earnings: number };
    tier3: { count: number; earnings: number };
  };
  recentConversions: any[];
}
