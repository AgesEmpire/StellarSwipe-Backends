import { WinLossMetrics } from '../analyzers/win-loss-analyzer';
import { TimingMetrics } from '../analyzers/timing-analyzer';
import { SizingMetrics } from '../analyzers/sizing-analyzer';
import { HoldingPeriodMetrics } from '../analyzers/holding-period-analyzer';
import { TradingInsightDto } from '../dto/trading-insight.dto';
import { ImprovementSuggestionDto } from '../dto/improvement-suggestion.dto';
import { InsightType } from '../entities/pattern-insight.entity';

export function matchPatterns(
  winLoss: WinLossMetrics,
  timing: TimingMetrics,
  sizing: SizingMetrics,
  holding: HoldingPeriodMetrics,
): { insights: TradingInsightDto[]; suggestions: ImprovementSuggestionDto[] } {
  const insights: TradingInsightDto[] = [];
  const suggestions: ImprovementSuggestionDto[] = [];

  if (winLoss.winRate >= 0.6) {
    insights.push({
      insightType: InsightType.STRENGTH,
      title: 'High Win Rate',
      description: `Your win rate of ${(winLoss.winRate * 100).toFixed(1)}% is above average.`,
      patternType: 'win_loss',
    });
  } else if (winLoss.winRate < 0.4) {
    insights.push({
      insightType: InsightType.WEAKNESS,
      title: 'Low Win Rate',
      description: `Win rate of ${(winLoss.winRate * 100).toFixed(1)}% needs improvement.`,
      patternType: 'win_loss',
    });
    suggestions.push({
      category: 'Entry Strategy',
      suggestion: 'Review entry criteria to improve trade selection quality.',
      priority: 'high',
      expectedImpact: 'Increase win rate by 10-15%',
    });
  }

  if (winLoss.profitFactor < 1) {
    suggestions.push({
      category: 'Risk Management',
      suggestion:
        'Losses exceed gains. Tighten stop-losses or improve exit strategy.',
      priority: 'high',
    });
  }

  if (sizing.oversizedTrades > sizing.undersizedTrades) {
    insights.push({
      insightType: InsightType.WEAKNESS,
      title: 'Position Oversizing',
      description: `${sizing.oversizedTrades} trades exceeded optimal size range.`,
      patternType: 'sizing',
    });
    suggestions.push({
      category: 'Position Sizing',
      suggestion: `Keep trade sizes between ${sizing.optimalSizeRange.min.toFixed(2)} and ${sizing.optimalSizeRange.max.toFixed(2)}.`,
      priority: 'medium',
    });
  }

  if (holding.earlyExits > holding.lateExits && holding.earlyExits > 2) {
    insights.push({
      insightType: InsightType.WEAKNESS,
      title: 'Premature Exits',
      description:
        'You tend to exit trades too early, potentially leaving profits on the table.',
      patternType: 'holding_period',
    });
    suggestions.push({
      category: 'Exit Strategy',
      suggestion:
        'Consider holding profitable trades longer based on your best holding range.',
      priority: 'medium',
      expectedImpact: `Optimal hold: ${holding.bestHoldingRangeHours.min.toFixed(1)}–${holding.bestHoldingRangeHours.max.toFixed(1)} hours`,
    });
  }

  const bestHourData = timing.tradesByHour[timing.bestHour];
  if (bestHourData?.avgPnl > 0) {
    insights.push({
      insightType: InsightType.OPPORTUNITY,
      title: 'Optimal Trading Hour',
      description: `Your best performance is at UTC hour ${timing.bestHour} with avg PnL ${bestHourData.avgPnl.toFixed(4)}.`,
      patternType: 'timing',
      data: { bestHour: timing.bestHour },
    });
  }

  const worstHourData = timing.tradesByHour[timing.worstHour];
  if (worstHourData?.avgPnl < 0) {
    insights.push({
      insightType: InsightType.WEAKNESS,
      title: 'Suboptimal Trading Hour',
      description: `You tend to lose most at UTC hour ${timing.worstHour} with avg loss ${Math.abs(worstHourData.avgPnl).toFixed(4)}.`,
      patternType: 'timing',
    });
    suggestions.push({
      category: 'Timing',
      suggestion: `Consider reducing trading activity during UTC hour ${timing.worstHour}.`,
      priority: 'low',
    });
  }

  if (timing.bestDayOfWeek !== undefined) {
    const days = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];
    insights.push({
      insightType: InsightType.STRENGTH,
      title: 'Profitable Trading Day',
      description: `Your most profitable day is ${days[timing.bestDayOfWeek]}.`,
      patternType: 'timing',
    });
  }

  if (holding.lateExits > holding.earlyExits && holding.lateExits > 2) {
    insights.push({
      insightType: InsightType.WEAKNESS,
      title: 'Delayed Exits',
      description:
         'You often hold trades too long, which might be turning winners into losers or increasing loss size.',
      patternType: 'holding_period',
    });
    suggestions.push({
      category: 'Exit Strategy',
      suggestion: 'Set strict time-based exits or use trailing stops to lock in profits.',
      priority: 'high',
    });
  }

  return { insights, suggestions };
}
