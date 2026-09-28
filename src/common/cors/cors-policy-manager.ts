/**
 * Centralizes CORS policy definitions per environment so allowed origins
 * are managed consistently instead of being configured ad-hoc, reducing
 * the risk of an overly permissive policy reaching production.
 */
export type Environment = 'development' | 'staging' | 'testnet' | 'mainnet' | 'production';

export interface CorsPolicy {
  origins: string[];
  allowWildcard: boolean;
}

const ENVIRONMENT_POLICIES: Record<Environment, CorsPolicy> = {
  development: { origins: ['http://localhost:3000', 'http://localhost:5173'], allowWildcard: true },
  testnet: { origins: [], allowWildcard: false },
  staging: { origins: [], allowWildcard: false },
  mainnet: { origins: [], allowWildcard: false },
  production: { origins: [], allowWildcard: false },
};

export class CorsPolicyManager {
  /**
   * Resolves the effective CORS policy for an environment, merging in any
   * explicitly configured allowlist. Wildcard origins are rejected outright
   * for any non-development environment to prevent overly permissive access.
   */
  static resolvePolicy(env: Environment, configuredAllowlist: string[] = []): CorsPolicy {
    const base = ENVIRONMENT_POLICIES[env] ?? ENVIRONMENT_POLICIES.production;

    if (!base.allowWildcard && configuredAllowlist.includes('*')) {
      throw new Error(`Wildcard CORS origin is not permitted in environment "${env}"`);
    }

    const origins = Array.from(new Set([...base.origins, ...configuredAllowlist])).filter(Boolean);

    if (env !== 'development' && origins.length === 0) {
      throw new Error(`No CORS origins configured for environment "${env}"; refusing to start with an implicit allow-all policy`);
    }

    return { origins, allowWildcard: base.allowWildcard };
  }

  static isOriginAllowed(env: Environment, origin: string, configuredAllowlist: string[] = []): boolean {
    const policy = this.resolvePolicy(env, configuredAllowlist);
    return policy.origins.includes(origin);
  }
}
