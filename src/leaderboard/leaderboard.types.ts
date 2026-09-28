import { LeaderboardPeriod } from './dto/leaderboard-query.dto';

export interface ProviderLeaderboardEntry {
  rank: number;
  providerId: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  winRate: number;
  totalPnl: number;
  signalCount: number;
  score: number;
}

export interface UserLeaderboardEntry {
  rank: number;
  userId: string;
  username: string | null;
  displayName: string | null;
  totalReturn: number;
  averageReturn: number;
  adoptionCount: number;
  successRate: number;
  score: number;
}

export type LeaderboardEntry = ProviderLeaderboardEntry | UserLeaderboardEntry;

export interface LeaderboardResponse<T extends LeaderboardEntry = LeaderboardEntry> {
  leaderboard: T[];
  period: LeaderboardPeriod;
  cachedAt: string;
  page: number;
  limit: number;
  total: number;
}
