import { ConfigValidationService } from '../src/config/config-validation.service';
import {
  ValidatedEnvironment,
  validateEnvironment,
} from '../src/config/schemas/config.schema';

const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_USER: 'user',
  DATABASE_PASSWORD: 'pass',
  DATABASE_NAME: 'db',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  STELLAR_NETWORK: 'testnet',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  STELLAR_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org:443',
  STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  JWT_SECRET: 'a-very-secure-jwt-secret-at-least-32-chars',
  XAI_API_KEY: 'xai-key',
  ENCRYPTION_KEY: 'a-very-secure-encryption-key-32chars',
};

const withEnv = (env: NodeJS.ProcessEnv, callback: () => void) => {
  const original = { ...process.env };
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.assign(process.env, env);

  try {
    callback();
  } finally {
    Object.keys(process.env).forEach((key) => delete process.env[key]);
    Object.assign(process.env, original);
  }
};

describe('configuration schema validation (#923)', () => {
  it('returns typed values and defaults for a valid environment', () => {
    const validated = validateEnvironment(VALID_ENV);

    expect(validated).toMatchObject<Partial<ValidatedEnvironment>>({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_PORT: 5432,
      REDIS_PORT: 6379,
      STELLAR_NETWORK: 'testnet',
      JWT_EXPIRES_IN: '7d',
      DATABASE_POOL_MIN: 10,
      DATABASE_POOL_MAX: 30,
    });
  });

  it('allows the test runtime environment used by Nest test modules', () => {
    expect(
      validateEnvironment({ ...VALID_ENV, NODE_ENV: 'test' }).NODE_ENV,
    ).toBe('test');
  });

  it('rejects missing required values', () => {
    const env = { ...VALID_ENV };
    delete env.DATABASE_HOST;

    expect(() => validateEnvironment(env)).toThrow(/DATABASE_HOST/);
  });

  it('rejects invalid enum values', () => {
    expect(() =>
      validateEnvironment({ ...VALID_ENV, STELLAR_NETWORK: 'devnet' }),
    ).toThrow(/STELLAR_NETWORK/);
  });

  it('rejects numeric values outside allowed ranges', () => {
    expect(() => validateEnvironment({ ...VALID_ENV, PORT: '70000' })).toThrow(
      /PORT/,
    );
    expect(() =>
      validateEnvironment({
        ...VALID_ENV,
        DATABASE_POOL_MIN: '20',
        DATABASE_POOL_MAX: '10',
      }),
    ).toThrow(/DATABASE_POOL_MAX/);
  });

  it('reports multiple validation errors at once', () => {
    const env = {
      ...VALID_ENV,
      JWT_SECRET: 'short',
      STELLAR_HORIZON_URL: 'not-a-url',
    };
    delete env.DATABASE_HOST;

    let errorMessage = '';
    try {
      validateEnvironment(env);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toMatch(/DATABASE_HOST/);
    expect(errorMessage).toMatch(/JWT_SECRET/);
    expect(errorMessage).toMatch(/STELLAR_HORIZON_URL/);
  });

  it('startup validation succeeds for valid config and fails for invalid config', () => {
    withEnv(VALID_ENV, () => {
      const service = new ConfigValidationService();
      expect(() => service.onModuleInit()).not.toThrow();
    });

    withEnv({ ...VALID_ENV, JWT_SECRET: 'short' }, () => {
      const service = new ConfigValidationService();
      expect(() => service.onModuleInit()).toThrow(/JWT_SECRET/);
    });
  });
});
