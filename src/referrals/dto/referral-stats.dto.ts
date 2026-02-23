export class ReferralStatsDto {
  referralCode!: string;
  totalInvites!: number;
  successfulConversions!: number;
  pendingReferrals!: number;
  totalEarnings!: string;
  referrals!: {
    id: string;
    referredUsername: string;
    status: string;
    rewardAmount: string;
    createdAt: Date;
    rewardedAt?: Date;
  }[];
}
