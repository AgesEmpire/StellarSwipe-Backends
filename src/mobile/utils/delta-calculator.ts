/**
 * Strips null/undefined fields and renames keys to compact aliases.
 */
export function compressPayload<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;
}

/**
 * Returns adaptive polling interval based on battery level and network type.
 * - Low battery or cellular → longer interval
 */
export function adaptivePollingInterval(
  baseMs: number,
  batteryLevel?: number,
  networkType?: string,
): number {
  let multiplier = 1;
  if (networkType === 'cellular') multiplier *= 2;
  if (batteryLevel !== undefined && batteryLevel < 20) multiplier *= 3;
  return baseMs * multiplier;
}
