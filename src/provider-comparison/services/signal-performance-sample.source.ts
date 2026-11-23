import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThanOrEqual, Not, Repository, And } from 'typeorm';
import { Signal, SignalOutcome } from '../../signals/entities/signal.entity';
import { PerformanceSample, PerformanceSampleSource } from './provider-window-performance.service';

const EXCLUDED_OUTCOMES = new Set<SignalOutcome>([SignalOutcome.PENDING, SignalOutcome.CANCELLED]);

/** Reads closed provider signals as performance samples. */
@Injectable()
export class SignalPerformanceSampleSource implements PerformanceSampleSource {
  constructor(
    @InjectRepository(Signal)
    private readonly signals: Repository<Signal>,
  ) {}

  async fetchSamples(providerId: string, start: Date, end: Date): Promise<PerformanceSample[]> {
    const rows = await this.signals.find({
      where: {
        providerId,
        closedAt: And(Not(IsNull()), MoreThanOrEqual(start), LessThan(end)),
      },
      select: ['id', 'closedAt', 'outcome', 'totalProfitLoss'],
    });
    return rows
      .filter((s) => s.closedAt && !EXCLUDED_OUTCOMES.has(s.outcome))
      .map((s) => {
        const pnl = parseFloat(s.totalProfitLoss ?? '0') || 0;
        const win =
          s.outcome === SignalOutcome.TARGET_HIT
            ? true
            : s.outcome === SignalOutcome.STOP_LOSS_HIT
              ? false
              : pnl > 0
                ? true
                : pnl < 0
                  ? false
                  : null;
        return { closedAt: new Date(s.closedAt as Date), pnl, win };
      });
  }
}
