export interface FeatureFlagOverride {
  /** Environment name this override applies to, e.g. "production", "staging". */
  env?: string;
  /** Tenant id this override applies to. Omit to apply to all tenants in the env. */
  tenantId?: string;
  enabled: boolean;
}

export interface FeatureFlagDefinition {
  key: string;
  description?: string;
  /** Default state when no tenant/env override or rollout applies. */
  defaultEnabled: boolean;
  /** Percentage (0-100) of tenants to enable for, deterministic by tenantId hash. */
  rolloutPercentage?: number;
  overrides?: FeatureFlagOverride[];
}

export interface FeatureFlagEvaluation {
  key: string;
  tenantId?: string;
  env: string;
  enabled: boolean;
  reason: 'override' | 'rollout' | 'default' | 'unknown-flag';
}
