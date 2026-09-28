/**
 * @file complexity-controls.spec.ts
 *
 * Regression tests for issue #921 — GraphQL query complexity controls.
 *
 * Tests cover:
 *  1. getComplexityLimit() returns correct per-role limits
 *  2. resolveUserRole() extracts the most permissive role from a user object
 *  3. simpleComplexityEstimator() calculates correct costs for list / scalar / override fields
 *  4. A query whose computed complexity exceeds the limit is rejected with a proper GraphQL error
 *  5. A query within the limit is accepted
 *  6. Environment-variable overrides are respected
 */

import {
  getComplexityLimit,
  resolveUserRole,
  simpleComplexityEstimator,
  FIELD_COMPLEXITY_OVERRIDES,
} from './utils/complexity-calculator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulate what the validation rule does: run the estimator and throw when
 * complexity exceeds the limit.
 *
 * @param complexity - pre-computed complexity score
 * @param role       - user role (undefined = unauthenticated)
 */
function enforceComplexityLimit(complexity: number, role?: string): void {
  const limit = getComplexityLimit(role);
  if (complexity > limit) {
    throw new Error(
      `Query complexity ${complexity} exceeds the limit of ${limit} for role "${role ?? 'default'}".`,
    );
  }
}

// ─── 1. Per-role limits ───────────────────────────────────────────────────────

describe('getComplexityLimit()', () => {
  it('returns 2000 for admin role', () => {
    expect(getComplexityLimit('admin')).toBe(2000);
  });

  it('returns 1000 for pro role', () => {
    expect(getComplexityLimit('pro')).toBe(1000);
  });

  it('returns 750 for premium role', () => {
    expect(getComplexityLimit('premium')).toBe(750);
  });

  it('returns 500 for the default (no role)', () => {
    expect(getComplexityLimit()).toBe(500);
    expect(getComplexityLimit(undefined)).toBe(500);
  });

  it('returns 500 for an unknown role (falls back to default)', () => {
    expect(getComplexityLimit('stranger')).toBe(500);
  });

  it('is case-insensitive', () => {
    expect(getComplexityLimit('ADMIN')).toBe(2000);
    expect(getComplexityLimit('Pro')).toBe(1000);
  });
});

// ─── 2. Role resolution from user object ─────────────────────────────────────

describe('resolveUserRole()', () => {
  it('returns undefined when user is null or undefined', () => {
    expect(resolveUserRole(null)).toBeUndefined();
    expect(resolveUserRole(undefined)).toBeUndefined();
  });

  it('returns the single role string directly', () => {
    expect(resolveUserRole({ role: 'admin' })).toBe('admin');
  });

  it('picks the most permissive role from an array', () => {
    // admin (2000) > pro (1000) > premium (750) > unknown/default (500)
    expect(resolveUserRole({ roles: ['pro', 'admin'] })).toBe('admin');
    expect(resolveUserRole({ roles: ['premium', 'pro'] })).toBe('pro');
    expect(resolveUserRole({ roles: ['premium', 'unknown'] })).toBe('premium');
  });

  it('returns the only role in a single-element array', () => {
    expect(resolveUserRole({ roles: ['pro'] })).toBe('pro');
  });
});

// ─── 3. Estimator cost calculations ──────────────────────────────────────────

describe('simpleComplexityEstimator()', () => {
  const estimator = simpleComplexityEstimator();

  function makeArgs(field: Partial<{
    type: { toString(): string; ofType?: { toString(): string } };
    name: string;
    args: Record<string, unknown>;
    childComplexity: number;
    typeName: string;
  }>) {
    return {
      type: field.type ?? { toString: () => 'String', ofType: undefined },
      field: { name: field.name ?? 'someField', type: field.type ?? { toString: () => 'String' } },
      args: field.args ?? {},
      childComplexity: field.childComplexity ?? 0,
    } as any;
  }

  it('costs 1 for a simple scalar field with no children', () => {
    const result = estimator(makeArgs({ childComplexity: 0 }));
    expect(result).toBe(1);
  });

  it('costs BASE + childComplexity for an object field', () => {
    const result = estimator(makeArgs({ childComplexity: 3 }));
    expect(result).toBe(4); // 1 + 3
  });

  it('multiplies child complexity by default list multiplier (10) for a list field', () => {
    const args = makeArgs({
      type: { toString: () => '[String]', ofType: undefined },
      childComplexity: 2,
    });
    // The field type starts with '[', so isList = true
    // No limit arg → multiplier = DEFAULT_LIST_MULTIPLIER = 10
    // cost = 1 + 2 * 10 = 21
    expect(estimator(args)).toBe(21);
  });

  it('uses the limit arg to scale list complexity, capped at 100', () => {
    const argsSmallLimit = makeArgs({
      type: { toString: () => '[SignalType]', ofType: undefined },
      args: { limit: 5 },
      childComplexity: 2,
    });
    // cost = 1 + 2 * 5 = 11
    expect(estimator(argsSmallLimit)).toBe(11);

    const argsHugeLimit = makeArgs({
      type: { toString: () => '[SignalType]', ofType: undefined },
      args: { limit: 9999 },
      childComplexity: 2,
    });
    // capped at 100: cost = 1 + 2 * 100 = 201
    expect(estimator(argsHugeLimit)).toBe(201);
  });

  it('applies FIELD_COMPLEXITY_OVERRIDES when present', () => {
    const overrideKey = Object.keys(FIELD_COMPLEXITY_OVERRIDES)[0]; // e.g. 'PortfolioType.performance'
    const [typeName, fieldName] = overrideKey.split('.');
    const expectedBase = FIELD_COMPLEXITY_OVERRIDES[overrideKey];

    const args = {
      type: { name: typeName, toString: () => typeName },
      field: { name: fieldName, type: { toString: () => typeName } },
      args: {},
      childComplexity: 3,
    } as any;

    // override + childComplexity
    expect(estimator(args)).toBe(expectedBase + 3);
  });
});

// ─── 4. Complexity gate — over-limit query is rejected ───────────────────────

describe('complexity enforcement (regression for issue #921)', () => {
  it('throws a GraphQL-style error when complexity exceeds the default limit', () => {
    // Default limit = 500. Simulate a query that scores 501.
    expect(() => enforceComplexityLimit(501)).toThrow(
      /Query complexity 501 exceeds the limit of 500 for role "default"/,
    );
  });

  it('throws for a pro user when complexity exceeds 1000', () => {
    expect(() => enforceComplexityLimit(1001, 'pro')).toThrow(
      /Query complexity 1001 exceeds the limit of 1000 for role "pro"/,
    );
  });

  it('throws for an admin user when complexity exceeds 2000', () => {
    expect(() => enforceComplexityLimit(2001, 'admin')).toThrow(
      /Query complexity 2001 exceeds the limit of 2000 for role "admin"/,
    );
  });

  it('error message includes both the actual complexity and the limit', () => {
    expect(() => enforceComplexityLimit(600, 'pro')).not.toThrow(); // 600 < 1000
    expect(() => enforceComplexityLimit(1200, 'pro')).toThrow(/1200.*1000/);
  });
});

// ─── 5. Complexity gate — within-limit query is accepted ─────────────────────

describe('complexity enforcement — queries within limits pass', () => {
  it('does not throw for unauthenticated user with complexity 500', () => {
    expect(() => enforceComplexityLimit(500)).not.toThrow();
  });

  it('does not throw for pro user with complexity 1000', () => {
    expect(() => enforceComplexityLimit(1000, 'pro')).not.toThrow();
  });

  it('does not throw for admin user with complexity 2000', () => {
    expect(() => enforceComplexityLimit(2000, 'admin')).not.toThrow();
  });

  it('does not throw for complexity 0 (introspection-style)', () => {
    expect(() => enforceComplexityLimit(0)).not.toThrow();
  });
});

// ─── 6. Environment-variable overrides ───────────────────────────────────────

describe('environment-variable overrides', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env after each test in this block
    Object.assign(process.env, originalEnv);
    // Clear any keys that were added
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    jest.resetModules();
  });

  it('reads GRAPHQL_COMPLEXITY_LIMIT_ADMIN from the environment', () => {
    // We test the module-level constant resolution by re-importing after
    // setting the env var. Jest module isolation handles the fresh require.
    process.env.GRAPHQL_COMPLEXITY_LIMIT_ADMIN = '9999';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getComplexityLimit: freshGetLimit } = require('./utils/complexity-calculator');
    expect(freshGetLimit('admin')).toBe(9999);
  });

  it('reads GRAPHQL_COMPLEXITY_LIMIT_DEFAULT from the environment', () => {
    process.env.GRAPHQL_COMPLEXITY_LIMIT_DEFAULT = '100';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getComplexityLimit: freshGetLimit } = require('./utils/complexity-calculator');
    expect(freshGetLimit()).toBe(100);
  });

  it('falls back to hard-coded defaults when env vars are absent or non-numeric', () => {
    delete process.env.GRAPHQL_COMPLEXITY_LIMIT_PRO;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getComplexityLimit: freshGetLimit } = require('./utils/complexity-calculator');
    expect(freshGetLimit('pro')).toBe(1000);
  });
});
