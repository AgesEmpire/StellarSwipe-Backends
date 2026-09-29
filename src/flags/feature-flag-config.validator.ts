/**
 * Startup validation for environment-driven feature flags (FF_*).
 *
 * Each flag is declared once in FEATURE_FLAG_SCHEMA. At startup every FF_*
 * variable is checked for a known name, a well-formed value and, in
 * production, the presence of required explicit overrides. Any problem
 * aborts startup with a single aggregated diagnostic.
 */
export interface FeatureFlagDefinition {
  name: string;
  envKey: string;
  description: string;
  defaultEnabled: boolean;
  /** Must be set explicitly (enabled + rollout) when NODE_ENV=production. */
  requiredInProduction?: boolean;
}

export interface ValidatedFeatureFlag {
  name: string;
  enabled: boolean;
  rolloutPercentage: number;
  description: string;
}

export const FEATURE_FLAG_SCHEMA: readonly FeatureFlagDefinition[] = [
  { name: 'new_portfolio_ui', envKey: 'FF_NEW_PORTFOLIO_UI', description: 'Gradual rollout of new portfolio UI', defaultEnabled: false },
  { name: 'advanced_analytics', envKey: 'FF_ADVANCED_ANALYTICS', description: 'Advanced analytics features', defaultEnabled: false },
  { name: 'soroban_contracts', envKey: 'FF_SOROBAN_CONTRACTS', description: 'Soroban smart contract integration', defaultEnabled: false, requiredInProduction: true },
  { name: 'automated_trading', envKey: 'FF_AUTOMATED_TRADING', description: 'Automated trading features', defaultEnabled: false, requiredInProduction: true },
  { name: 'signal_marketplace', envKey: 'FF_SIGNAL_MARKETPLACE', description: 'Signal marketplace features', defaultEnabled: false },
];

const ROLLOUT_SUFFIX = '_ROLLOUT';
const BOOLEAN_VALUES: Record<string, boolean> = { true: true, '1': true, false: false, '0': false };

export class FeatureFlagConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid feature flag configuration (${problems.length} problem(s)):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'FeatureFlagConfigError';
  }
}

export function validateFeatureFlagConfig(
  env: Record<string, string | undefined>,
  schema: readonly FeatureFlagDefinition[] = FEATURE_FLAG_SCHEMA,
): ValidatedFeatureFlag[] {
  const problems: string[] = [];
  const isProduction = env.NODE_ENV === 'production';
  const knownKeys = new Set(schema.flatMap((d) => [d.envKey, d.envKey + ROLLOUT_SUFFIX]));

  for (const key of Object.keys(env)) {
    if (key.startsWith('FF_') && !knownKeys.has(key)) {
      problems.push(`${key}: unknown feature flag (known: ${schema.map((d) => d.envKey).join(', ')})`);
    }
  }

  const flags = schema.map((def) => {
    const rawEnabled = env[def.envKey]?.trim();
    const rolloutKey = def.envKey + ROLLOUT_SUFFIX;
    const rawRollout = env[rolloutKey]?.trim();

    let enabled = def.defaultEnabled;
    if (rawEnabled === undefined || rawEnabled === '') {
      if (isProduction && def.requiredInProduction) {
        problems.push(`${def.envKey}: required in production but not set (expected true|false)`);
      }
    } else if (rawEnabled.toLowerCase() in BOOLEAN_VALUES) {
      enabled = BOOLEAN_VALUES[rawEnabled.toLowerCase()];
    } else {
      problems.push(`${def.envKey}: expected boolean (true|false|1|0), got "${rawEnabled}"`);
    }

    let rolloutPercentage = enabled ? 100 : 0;
    if (rawRollout === undefined || rawRollout === '') {
      if (isProduction && def.requiredInProduction && enabled) {
        problems.push(`${rolloutKey}: required in production when ${def.envKey}=true (expected integer 0-100)`);
      }
    } else if (!/^\d+$/.test(rawRollout) || Number(rawRollout) > 100) {
      problems.push(`${rolloutKey}: expected integer 0-100, got "${rawRollout}"`);
    } else {
      rolloutPercentage = Number(rawRollout);
      if (!enabled && rolloutPercentage > 0) {
        problems.push(`${rolloutKey}: rollout ${rolloutPercentage}% set but ${def.envKey} is disabled`);
      }
    }

    return { name: def.name, enabled, rolloutPercentage, description: def.description };
  });

  if (problems.length > 0) throw new FeatureFlagConfigError(problems);
  return flags;
}
