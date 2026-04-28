import { Participant } from '../entities/participant.entity';
import { CompetitionTrade } from '../entities/competition-trade.entity';

export type ScoringMetric = 'PNL' | 'ROI_BPS' | 'VOLUME' | 'WIN_RATE' | 'COMPOSITE';

export interface ScoringWeights {
  pnl?: number;
  roiBps?: number;
  volume?: number;
  winRate?: number;
}

export interface ParticipantPerformanceSnapshot {
  realizedPnl: string;
  volume: string;
  winRate: number;
  tradeCount: number;
}

export interface ScoringSystem {
  readonly metric: ScoringMetric;
  readonly weights?: ScoringWeights;
  scoreParticipant(
    participant: Participant,
    trades: CompetitionTrade[],
    snapshot: ParticipantPerformanceSnapshot,
  ): number;
}
