export interface UptimeRequirement {
  targetPercent: number;
  windowHours: number;
  maxAllowedDowntimeMinutes: number;
}

export interface UptimeMeasurement {
  windowStart: Date;
  windowEnd: Date;
  totalMinutes: number;
  downtimeMinutes: number;
  uptimePercent: number;
  breached: boolean;
}

export function computeMaxDowntime(uptimePercent: number, windowHours: number): number {
  return ((100 - uptimePercent) / 100) * windowHours * 60;
}
