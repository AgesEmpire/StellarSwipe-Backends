import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Trade } from '../../trades/entities/trade.entity';
import { TradingPattern, PatternType } from './entities/trading-pattern.entity';
import { PatternInsight } from './entities/pattern-insight.entity';
import { PatternAnalysisDto } from './dto/pattern-analysis.dto';
import { TradingInsightDto } from './dto/trading-insight.dto';
import { ImprovementSuggestionDto } from './dto/improvement-suggestion.dto';
import { analyzeWinLoss } from './analyzers/win-loss-analyzer';
import { analyzeTiming } from './analyzers/timing-analyzer';
import { analyzeSizing } from './analyzers/sizing-analyzer';
import { analyzeHoldingPeriod } from './analyzers/holding-period-analyzer';
import { matchPatterns } from './utils/pattern-matcher';

@Injectable()
export class PatternAnalyzerService {
  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(TradingPattern)
    private readonly patternRepo: Repository<TradingPattern>,
    @InjectRepository(PatternInsight)
    private readonly insightRepo: Repository<PatternInsight>,
  ) {}

  async analyze(dto: PatternAnalysisDto): Promise<{
    patterns: TradingPattern[];
    insights: TradingInsightDto[];
    suggestions: ImprovementSuggestionDto[];
  }> {
    const where: Record<string, unknown> = { userId: dto.userId };
    if (dto.from && dto.to) {
      where['createdAt'] = Between(new Date(dto.from), new Date(dto.to));
    }

    const trades = await this.tradeRepo.find({ where });

    const winLoss = analyzeWinLoss(trades);
    const timing = analyzeTiming(trades);
    const sizing = analyzeSizing(trades);
    const holding = analyzeHoldingPeriod(trades);

    const now = new Date();
    const patterns = await Promise.all([
      this.upsertPattern(dto.userId, PatternType.WIN_LOSS, winLoss, now),
      this.upsertPattern(dto.userId, PatternType.TIMING, timing, now),
      this.upsertPattern(dto.userId, PatternType.SIZING, sizing, now),
      this.upsertPattern(dto.userId, PatternType.HOLDING_PERIOD, holding, now),
    ]);

    const { insights, suggestions } = matchPatterns(
      winLoss,
      timing,
      sizing,
      holding,
    );

    await this.insightRepo.delete({ userId: dto.userId });
    if (insights.length) {
      await this.insightRepo.save(
        insights.map((i) =>
          this.insightRepo.create({ ...i, userId: dto.userId }),
        ),
      );
    }

    return { patterns, insights, suggestions };
  }

  async getPatterns(userId: string): Promise<TradingPattern[]> {
    return this.patternRepo.find({ where: { userId } });
  }

  async getInsights(userId: string): Promise<PatternInsight[]> {
    return this.insightRepo.find({ where: { userId } });
  }

  private async upsertPattern(
    userId: string,
    patternType: PatternType,
    metrics: object,
    analyzedAt: Date,
  ): Promise<TradingPattern> {
    let pattern = await this.patternRepo.findOne({
      where: { userId, patternType },
    });
    if (pattern) {
      pattern.metrics = metrics;
      pattern.analyzedAt = analyzedAt;
    } else {
      pattern = this.patternRepo.create({
        userId,
        patternType,
        metrics,
        analyzedAt,
      });
    }
    return this.patternRepo.save(pattern);
  }
}
