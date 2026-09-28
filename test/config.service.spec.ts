import { ConfigService } from '../src/config/config.service';
import { ConfigService as NestConfigService } from '@nestjs/config';

const makeNestConfig = (overrides: Record<string, unknown> = {}) => {
  const store: Record<string, unknown> = {
    'app.environment': 'development',
    'app.port': 3000,
    'app.host': 'localhost',
    'database.host': 'localhost',
    'database.port': 5432,
    'redis.host': 'localhost',
    'redis.port': 6379,
    'jwt.secret': 'super-secret-32-chars-minimum!!',
    'jwt.expiresIn': '7d',
    ...overrides,
  };

  return {
    get: jest.fn((key: string, def?: unknown) => store[key] ?? def),
    getOrThrow: jest.fn((key: string) => {
      if (store[key] === undefined) throw new Error(`Config key "${key}" not found`);
      return store[key];
    }),
  } as unknown as NestConfigService;
};

describe('ConfigService (#369)', () => {
  it('exposes only documented application properties', () => {
    const svc = new ConfigService(makeNestConfig());
    expect(svc.nodeEnv).toBe('development');
    expect(svc.port).toBe(3000);
    expect(svc.host).toBe('localhost');
  });

  it('exposes redis connection properties', () => {
    const svc = new ConfigService(makeNestConfig({ 'redis.host': 'redis-server', 'redis.port': 6380 }));
    expect(svc.redisHost).toBe('redis-server');
    expect(svc.redisPort).toBe(6380);
  });

  it('exposes jwt properties', () => {
    const svc = new ConfigService(makeNestConfig({ 'jwt.expiresIn': '1d' }));
    expect(svc.jwtSecret).toBe('super-secret-32-chars-minimum!!');
    expect(svc.jwtExpiresIn).toBe('1d');
  });

  it('getOrThrow propagates when jwt.secret is missing', () => {
    const nest = makeNestConfig();
    (nest.getOrThrow as jest.Mock).mockImplementation((key: string) => {
      if (key === 'jwt.secret') throw new Error(`Config key "${key}" not found`);
      return 'value';
    });
    const svc = new ConfigService(nest);
    expect(() => svc.jwtSecret).toThrow('jwt.secret');
  });

  it('tracingEnabled reads TRACING_ENABLED env var', () => {
    const svc = new ConfigService(makeNestConfig());
    process.env.TRACING_ENABLED = 'true';
    expect(svc.tracingEnabled).toBe(true);
    process.env.TRACING_ENABLED = 'false';
    expect(svc.tracingEnabled).toBe(false);
    delete process.env.TRACING_ENABLED;
    expect(svc.tracingEnabled).toBe(false);
  });

  it('tracingServiceName falls back to default', () => {
    delete process.env.TRACING_SERVICE_NAME;
    const svc = new ConfigService(makeNestConfig());
    expect(svc.tracingServiceName).toBe('stellarswipe-backend');
  });

  it('does not expose undocumented env vars as properties', () => {
    process.env.SOME_UNUSED_LEGACY_VAR = 'should-not-appear';
    const svc = new ConfigService(makeNestConfig()) as unknown as Record<string, unknown>;
    expect(svc['SOME_UNUSED_LEGACY_VAR']).toBeUndefined();
    expect(svc['someUnusedLegacyVar']).toBeUndefined();
    delete process.env.SOME_UNUSED_LEGACY_VAR;
  });
});
