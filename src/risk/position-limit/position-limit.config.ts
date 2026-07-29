export const POSITION_LIMIT_CONFIG = {
  defaultMaxExposureUSD: Number(process.env.MAX_EXPOSURE_USD ?? 10_000),
  perPairOverrides: (() => {
    try {
      return JSON.parse(process.env.PAIR_LIMITS ?? '{}') as Record<string, number>;
    } catch {
      return {} as Record<string, number>;
    }
  })(),
};
