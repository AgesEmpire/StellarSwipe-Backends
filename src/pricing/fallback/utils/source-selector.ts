export interface PricingSource {
  name: string;
  priority: number;
  isAvailable: boolean;
}

export function selectBestSource(sources: PricingSource[]): PricingSource | null {
  const available = sources
    .filter((s) => s.isAvailable)
    .sort((a, b) => a.priority - b.priority);
  return available[0] ?? null;
}

export function buildSourceList(primary: string, fallbacks: string[]): PricingSource[] {
  return [
    { name: primary, priority: 0, isAvailable: true },
    ...fallbacks.map((name, index) => ({ name, priority: index + 1, isAvailable: true })),
  ];
}
