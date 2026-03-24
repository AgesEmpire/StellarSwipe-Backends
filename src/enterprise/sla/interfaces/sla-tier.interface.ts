export enum SlaTierName {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

export interface SlaTier {
  name: SlaTierName;
  uptimePercent: number;       // e.g. 99.9
  maxResponseTimeMs: number;   // p95 threshold
  maxErrorRatePercent: number; // e.g. 1.0
  minThroughputRpm: number;    // guaranteed RPM
  supportResponseHours: number;
  priorityRouting: boolean;
}

export const SLA_TIERS: Record<SlaTierName, SlaTier> = {
  [SlaTierName.BRONZE]: {
    name: SlaTierName.BRONZE,
    uptimePercent: 99.0,
    maxResponseTimeMs: 2000,
    maxErrorRatePercent: 2.0,
    minThroughputRpm: 100,
    supportResponseHours: 48,
    priorityRouting: false,
  },
  [SlaTierName.SILVER]: {
    name: SlaTierName.SILVER,
    uptimePercent: 99.5,
    maxResponseTimeMs: 1000,
    maxErrorRatePercent: 1.0,
    minThroughputRpm: 500,
    supportResponseHours: 24,
    priorityRouting: false,
  },
  [SlaTierName.GOLD]: {
    name: SlaTierName.GOLD,
    uptimePercent: 99.9,
    maxResponseTimeMs: 500,
    maxErrorRatePercent: 0.5,
    minThroughputRpm: 2000,
    supportResponseHours: 4,
    priorityRouting: true,
  },
  [SlaTierName.PLATINUM]: {
    name: SlaTierName.PLATINUM,
    uptimePercent: 99.99,
    maxResponseTimeMs: 200,
    maxErrorRatePercent: 0.1,
    minThroughputRpm: 10000,
    supportResponseHours: 1,
    priorityRouting: true,
  },
};
