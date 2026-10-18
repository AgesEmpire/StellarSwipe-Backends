import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  collectOpenApiDeprecatedRoutes,
  RouteDeprecationInfo,
  validateDeprecationSunsets,
} from './deprecation-sunset-validator';

describe('validateDeprecationSunsets (issue #1379)', () => {
  it('passes a deprecated route with a valid YYYY-MM-DD sunset date', () => {
    const routes: RouteDeprecationInfo[] = [
      {
        route: 'GET /trades/user/:userId',
        isDeprecated: true,
        metadata: { sunsetDate: '2026-12-31' },
      },
    ];

    expect(validateDeprecationSunsets(routes)).toEqual([]);
  });

  it('flags a deprecated route with no sunsetDate at all', () => {
    const routes: RouteDeprecationInfo[] = [
      { route: 'GET /legacy/signals', isDeprecated: true, metadata: undefined },
    ];

    const issues = validateDeprecationSunsets(routes);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      route: 'GET /legacy/signals',
      reason: 'missing_sunset_date',
    });
  });

  it('flags a deprecated route with an empty-string sunsetDate', () => {
    const routes: RouteDeprecationInfo[] = [
      { route: 'GET /legacy/portfolio', isDeprecated: true, metadata: { sunsetDate: '   ' } },
    ];

    const issues = validateDeprecationSunsets(routes);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toBe('missing_sunset_date');
  });

  it('flags a deprecated route with a malformed sunsetDate', () => {
    const routes: RouteDeprecationInfo[] = [
      { route: 'POST /legacy/trades', isDeprecated: true, metadata: { sunsetDate: 'next quarter' } },
    ];

    const issues = validateDeprecationSunsets(routes);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      route: 'POST /legacy/trades',
      reason: 'invalid_sunset_date',
    });
  });

  it('flags a sunsetDate that does not match the YYYY-MM-DD format even if Date.parse would accept it', () => {
    const routes: RouteDeprecationInfo[] = [
      { route: 'GET /legacy/prices', isDeprecated: true, metadata: { sunsetDate: '12/31/2026' } },
    ];

    const issues = validateDeprecationSunsets(routes);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toBe('invalid_sunset_date');
  });

  it('never flags an active (non-deprecated) route, even without sunset metadata', () => {
    const routes: RouteDeprecationInfo[] = [
      { route: 'GET /trades/active', isDeprecated: false },
    ];

    expect(validateDeprecationSunsets(routes)).toEqual([]);
  });

  it('validates a mixed batch of active and deprecated routes independently', () => {
    const routes: RouteDeprecationInfo[] = [
      { route: 'GET /trades/active', isDeprecated: false },
      { route: 'GET /trades/legacy', isDeprecated: true, metadata: { sunsetDate: '2026-06-01' } },
      { route: 'GET /signals/legacy', isDeprecated: true, metadata: undefined },
    ];

    const issues = validateDeprecationSunsets(routes);
    expect(issues).toHaveLength(1);
    expect(issues[0].route).toBe('GET /signals/legacy');
  });
});

describe('collectOpenApiDeprecatedRoutes (issue #1379)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'deprecation-sunset-spec-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSpec(spec: unknown): string {
    const specPath = join(dir, 'openapi.json');
    writeFileSync(specPath, JSON.stringify(spec), 'utf-8');
    return specPath;
  }

  it('returns an empty array when the spec file does not exist', () => {
    expect(collectOpenApiDeprecatedRoutes(join(dir, 'missing.json'))).toEqual([]);
  });

  it('extracts x-sunset as the sunsetDate for deprecated operations', () => {
    const specPath = writeSpec({
      paths: {
        '/trades/user/{userId}': {
          get: { deprecated: true, 'x-sunset': '2026-12-31' },
        },
      },
    });

    const routes = collectOpenApiDeprecatedRoutes(specPath);
    expect(routes).toEqual([
      {
        route: 'GET /trades/user/{userId}',
        isDeprecated: true,
        metadata: { sunsetDate: '2026-12-31' },
      },
    ]);
  });

  it('marks a route deprecated with no metadata when x-sunset is missing', () => {
    const specPath = writeSpec({
      paths: {
        '/legacy/signals': {
          get: { deprecated: true },
        },
      },
    });

    const routes = collectOpenApiDeprecatedRoutes(specPath);
    expect(routes[0].isDeprecated).toBe(true);
    expect(routes[0].metadata?.sunsetDate).toBeUndefined();

    // Feeding this straight into the validator must catch it.
    expect(validateDeprecationSunsets(routes)).toEqual([
      expect.objectContaining({ reason: 'missing_sunset_date' }),
    ]);
  });

  it('does not mark active operations as deprecated', () => {
    const specPath = writeSpec({
      paths: {
        '/trades/active': {
          get: {},
          post: { summary: 'create a trade' },
        },
      },
    });

    const routes = collectOpenApiDeprecatedRoutes(specPath);
    expect(routes.every((r) => !r.isDeprecated)).toBe(true);
    expect(validateDeprecationSunsets(routes)).toEqual([]);
  });
});
