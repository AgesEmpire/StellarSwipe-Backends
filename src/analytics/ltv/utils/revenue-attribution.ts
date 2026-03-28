/**
 * Attribute revenue across trading activity, subscription, and engagement.
 */
export function attributeRevenue(
  tradeVolume: number,
  avgMonthlyRevenue: number,
  engagementScore: number,
): { tradeRevenue: number; subscriptionRevenue: number; engagementBonus: number; total: number } {
  const tradeRevenue = tradeVolume * 0.001;
  const subscriptionRevenue = avgMonthlyRevenue;
  const engagementBonus = avgMonthlyRevenue * engagementScore * 0.1;
  return {
    tradeRevenue,
    subscriptionRevenue,
    engagementBonus,
    total: tradeRevenue + subscriptionRevenue + engagementBonus,
  };
}
