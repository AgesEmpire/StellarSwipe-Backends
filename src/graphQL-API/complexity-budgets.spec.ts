/**
 * Issue #1035 — GraphQL query complexity budgets per client class.
 *
 * Covers: anonymous / user / trusted budgets, env-var overrides,
 * alias/fragment/list cost, and bypass-attempt rejection.
 */
import {
  getComplexityLimit,
  resolveClientClass,
  resolveUserRole,
  simpleComplexityEstimator,
} from './utils/complexity-calculator';

// ─── Client-class budgets ─────────────────────────────────────────────────────

describe('getComplexityLimit() — client classes', () => {
  it('anonymous (no user) gets the tightest budget', () => {
    expect(getComplexityLimit()).toBeLessThanOrEqual(getComplexityLimit('user'));
  });

  it('user gets a mid-range budget', () => {
    expect(getComplexityLimit('user')).toBeLessThanOrEqual(getComplexityLimit('trusted'));
  });

  it('trusted gets the highest budget', () => {
    expect(getComplexityLimit('trusted')).toBeGreaterThan(getComplexityLimit('user'));
  });

  it('legacy admin alias maps to trusted-level budget', () => {
    expect(getComplexityLimit('admin')).toBeGreaterThanOrEqual(getComplexityLimit('user'));
  });

  it('is case-insensitive', () => {
    expect(getComplexityLimit('TRUSTED')).toBe(getComplexityLimit('trusted'));
    expect(getComplexityLimit('USER')).toBe(getComplexityLimit('user'));
  });
});

// ─── resolveClientClass ───────────────────────────────────────────────────────

describe('resolveClientClass()', () => {
  it('returns anonymous when user is null/undefined', () => {
    expect(resolveClientClass(null)).toBe('anonymous');
    expect(resolveClientClass(undefined)).toBe('anonymous');
  });

  it('returns user for a plain authenticated user', () => {
    expect(resolveClientClass({ role: 'user' })).toBe('user');
    expect(resolveClientClass({ roles: ['user'] })).toBe('user');
  });

  it('returns trusted for admin role', () => {
    expect(resolveClientClass({ role: 'admin' })).toBe('trusted');
  });

  it('returns trusted for pro role', () => {
    expect(resolveClientClass({ roles: ['pro'] })).toBe('trusted');
  });

  it('returns trusted when any role in array is privileged', () => {
    expect(resolveClientClass({ roles: ['user', 'admin'] })).toBe('trusted');
  });

  it('returns anonymous when roles array is empty', () => {
    expect(resolveClientClass({ roles: [] })).toBe('anonymous');
  });
});

// ─── Alias / fragment / list cost ────────────────────────────────────────────

describe('simpleComplexityEstimator() — alias, fragment, list, bypass', () => {
  const estimator = simpleComplexityEstimator();

  const makeArgs = (opts: {
    typeName?: string;
    fieldName?: string;
    typeStr?: string;
    args?: Record<string, unknown>;
    childComplexity?: number;
  }) => ({
    type: { name: opts.typeName ?? '', toString: () => opts.typeStr ?? opts.typeName ?? 'String' },
    field: {
      name: opts.fieldName ?? 'field',
      type: { toString: () => opts.typeStr ?? opts.typeName ?? 'String' },
    },
    args: opts.args ?? {},
    childComplexity: opts.childComplexity ?? 0,
  } as any);

  it('scalar field costs 1', () => {
    expect(estimator(makeArgs({}))).toBe(1);
  });

  it('list field multiplies child complexity by default multiplier', () => {
    const cost = estimator(makeArgs({ typeStr: '[SignalType]', childComplexity: 2 }));
    expect(cost).toBeGreaterThan(2); // 1 + 2 * 10 = 21
  });

  it('list field with explicit limit arg scales cost accordingly', () => {
    const cost5 = estimator(makeArgs({ typeStr: '[SignalType]', args: { limit: 5 }, childComplexity: 2 }));
    const cost50 = estimator(makeArgs({ typeStr: '[SignalType]', args: { limit: 50 }, childComplexity: 2 }));
    expect(cost50).toBeGreaterThan(cost5);
  });

  it('caps list multiplier at 100 to prevent bypass via huge limit arg', () => {
    const capped = estimator(makeArgs({ typeStr: '[SignalType]', args: { limit: 99999 }, childComplexity: 1 }));
    const max = estimator(makeArgs({ typeStr: '[SignalType]', args: { limit: 100 }, childComplexity: 1 }));
    expect(capped).toBe(max); // bypass attempt is capped
  });

  it('nested object fields accumulate child complexity', () => {
    const inner = estimator(makeArgs({ childComplexity: 0 })); // 1
    const outer = estimator(makeArgs({ childComplexity: inner })); // 1 + 1 = 2
    expect(outer).toBe(2);
  });
});

// ─── Enforcement gate ─────────────────────────────────────────────────────────

describe('complexity enforcement — client class budgets', () => {
  function enforce(complexity: number, clientClass?: string) {
    const limit = getComplexityLimit(clientClass);
    if (complexity > limit) {
      throw new Error(
        `Query complexity ${complexity} exceeds the limit of ${limit} for client class "${clientClass ?? 'anonymous'}".`,
      );
    }
  }

  it('rejects anonymous client over budget', () => {
    const limit = getComplexityLimit('anonymous');
    expect(() => enforce(limit + 1)).toThrow(/exceeds the limit/);
  });

  it('accepts anonymous client at budget', () => {
    const limit = getComplexityLimit('anonymous');
    expect(() => enforce(limit)).not.toThrow();
  });

  it('rejects user client over budget', () => {
    const limit = getComplexityLimit('user');
    expect(() => enforce(limit + 1, 'user')).toThrow(/exceeds the limit/);
  });

  it('accepts trusted client at budget', () => {
    const limit = getComplexityLimit('trusted');
    expect(() => enforce(limit, 'trusted')).not.toThrow();
  });

  it('error message includes complexity and limit', () => {
    const limit = getComplexityLimit('user');
    expect(() => enforce(limit + 100, 'user')).toThrow(new RegExp(`${limit + 100}.*${limit}`));
  });
});

// ─── Env-var overrides ────────────────────────────────────────────────────────

describe('environment-variable overrides', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    Object.keys(process.env).forEach((k) => { if (!(k in originalEnv)) delete process.env[k]; });
    jest.resetModules();
  });

  it('reads GRAPHQL_COMPLEXITY_LIMIT_ANONYMOUS from env', () => {
    process.env.GRAPHQL_COMPLEXITY_LIMIT_ANONYMOUS = '50';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getComplexityLimit: fresh } = require('./utils/complexity-calculator');
    expect(fresh('anonymous')).toBe(50);
  });

  it('reads GRAPHQL_COMPLEXITY_LIMIT_USER from env', () => {
    process.env.GRAPHQL_COMPLEXITY_LIMIT_USER = '800';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getComplexityLimit: fresh } = require('./utils/complexity-calculator');
    expect(fresh('user')).toBe(800);
  });

  it('reads GRAPHQL_COMPLEXITY_LIMIT_TRUSTED from env', () => {
    process.env.GRAPHQL_COMPLEXITY_LIMIT_TRUSTED = '9999';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getComplexityLimit: fresh } = require('./utils/complexity-calculator');
    expect(fresh('trusted')).toBe(9999);
  });
});
