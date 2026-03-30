export interface UserEngagementFeatures {
  daysSinceLastLogin: number;
  loginFrequency7d: number;   // logins in last 7 days
  tradeCount30d: number;
  signalViewCount30d: number;
  portfolioCheckCount7d: number;
}

/**
 * Computes a 0–100 engagement score from user activity features.
 * Higher = more engaged.
 */
export function computeEngagementScore(f: UserEngagementFeatures): number {
  const recency = Math.max(0, 100 - f.daysSinceLastLogin * 3);
  const frequency = Math.min(100, f.loginFrequency7d * 14);
  const activity = Math.min(100, (f.tradeCount30d * 2 + f.signalViewCount30d + f.portfolioCheckCount7d * 3));
  return Math.round((recency * 0.4 + frequency * 0.3 + activity * 0.3));
}
