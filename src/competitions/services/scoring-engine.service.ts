import { Injectable } from '@nestjs/common';
import { Participant } from '../entities/participant.entity';
import { CompetitionTrade } from '../entities/competition-trade.entity';
import {
  ParticipantPerformanceSnapshot,
  ScoringMetric,
} from '../interfaces/scoring-system.interface';
import { buildPerformanceSnapshot } from '../utils/performance-tracker';

@Injectable()
export class ScoringEngineService {
  scoreParticipant(
    metric: string,
    participant: Participant,
    trades: CompetitionTrade[],
  ): number {
    const snapshot = buildPerformanceSnapshot(trades);
    const m = (metric || 'PNL') as ScoringMetric;
    switch (m) {
      case 'ROI_BPS': {
        const vol = parseFloat(snapshot.volume) || 0;
        const pnl = parseFloat(snapshot.realizedPnl) || 0;
        if (vol <= 0) return 0;
        return (pnl / vol) * 10_000;
      }
      case 'VOLUME':
        return parseFloat(snapshot.volume) || 0;
      case 'WIN_RATE':
        return snapshot.winRate;
      case 'COMPOSITE': {
        const pnl = parseFloat(snapshot.realizedPnl) || 0;
        const vol = parseFloat(snapshot.volume) || 0;
        return pnl * 0.5 + vol * 0.0001 + snapshot.winRate * 100;
      }
      case 'PNL':
      default:
        return parseFloat(snapshot.realizedPnl) || 0;
    }
  }

  buildSnapshot(trades: CompetitionTrade[]): ParticipantPerformanceSnapshot {
    return buildPerformanceSnapshot(trades);
  }
}
