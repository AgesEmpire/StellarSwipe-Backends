import { UserFunnelProgress } from '../entities/user-funnel-progress.entity';

export interface DropOffSummary {
  stepKey: string;
  count: number;
  percentage: number;
}

export function analyzeDropOffs(
  progressRecords: UserFunnelProgress[],
  totalEntries: number,
): DropOffSummary[] {
  const dropOffMap = new Map<string, number>();

  for (const record of progressRecords) {
    if (record.droppedAtStep) {
      dropOffMap.set(record.droppedAtStep, (dropOffMap.get(record.droppedAtStep) ?? 0) + 1);
    }
  }

  return Array.from(dropOffMap.entries()).map(([stepKey, count]) => ({
    stepKey,
    count,
    percentage: totalEntries > 0 ? Math.round((count / totalEntries) * 10000) / 100 : 0,
  }));
}
