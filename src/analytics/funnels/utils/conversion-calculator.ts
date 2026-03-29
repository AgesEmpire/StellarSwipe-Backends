import { FunnelStepAnalysis } from '../dto/funnel-analysis.dto';
import { DropOffPoint } from '../dto/conversion-report.dto';

export function calculateConversionRates(
  stepCounts: Map<string, number>,
  steps: { key: string; name: string; order: number }[],
  totalEntries: number,
): FunnelStepAnalysis[] {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  return sorted.map((step, i) => {
    const usersReached = stepCounts.get(step.key) ?? 0;
    const prevCount = i === 0 ? totalEntries : (stepCounts.get(sorted[i - 1].key) ?? 0);
    const conversionRate = prevCount > 0 ? (usersReached / prevCount) * 100 : 0;
    return {
      stepKey: step.key,
      stepName: step.name,
      stepOrder: step.order,
      usersReached,
      conversionRate: Math.round(conversionRate * 100) / 100,
      dropOffRate: Math.round((100 - conversionRate) * 100) / 100,
    };
  });
}

export function getTopDropOffPoints(steps: FunnelStepAnalysis[]): DropOffPoint[] {
  return steps
    .filter((s) => s.dropOffRate > 0)
    .sort((a, b) => b.dropOffRate - a.dropOffRate)
    .map((s) => ({
      stepKey: s.stepKey,
      stepName: s.stepName,
      dropOffCount: s.usersReached,
      dropOffRate: s.dropOffRate,
    }));
}
