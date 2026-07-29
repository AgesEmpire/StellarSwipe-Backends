import { ConfigValidationService } from '../../src/config/config-validation.service';

/** Snapshot of the minimum valid environment. */
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
  JWT_SECRET: 'a-very-secure-jwt-secret-at-least-32-chars!!',
  XAI_API_KEY: 'xai-key',
  ENCRYPTION_KEY: 'a-very-secure-encryption-key-32chars!',
};

function makeService(overrides: NodeJS.ProcessEnv = {}): ConfigValidationService {
  // Temporarily override process.env for the duration of validate()
  const original = { ...process.env };
  Object.keys(process.env).forEach((k) => delete process.env[k]);
  Object.assign(process.env, { ...VALID_ENV, ...overrides });

  const svc = new ConfigValidationService();
  try {
    return svc;
  } finally {
    Object.keys(process.env).forEach((k) => delete process.env[k]);
    Object.assign(process.env, original);
  }
}

describe('ConfigValidationService – startup env validation (#Issue-2)', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Clear env so we control exactly what is visible during each test
    Object.keys(process.env).forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    Object.keys(process.env).forEach((k) => delete process.env[k]);
    Object.assign(process.env, savedEnv);
  });

  it('passes when all required variables are present', () => {
    Object.assign(process.env, VALID_ENV);
    const svc = new ConfigValidationService();
    expect(() => svc.validate()).not.toThrow();
  });

  it('fails with a clear message when DATABASE_HOST is missing', () => {
    const env = { ...VALID_ENV };
    delete env.DATABASE_HOST;
    Object.assign(process.env, env);
    const svc = new ConfigValidationService();
    expect(() => svc.validate()).toThrow(/DATABASE_HOST/);
  });

  it('fails with a clear message when JWT_SECRET is too short', () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_SECRET: 'short' });
    const svc = new ConfigValidationService();
    expect(() => svc.validate()).toThrow(/JWT_SECRET/);
  });

  it('fails with a clear message when STELLAR_HORIZON_URL is not a URI', () => {
    Object.assign(process.env, { ...VALID_ENV, STELLAR_HORIZON_URL: 'not-a-url' });
    const svc = new ConfigValidationService();
    expect(() => svc.validate()).toThrow(/STELLAR_HORIZON_URL/);
  });

  it('fails when ENCRYPTION_KEY is under 32 characters', () => {
    Object.assign(process.env, { ...VALID_ENV, ENCRYPTION_KEY: 'tooshort' });
    const svc = new ConfigValidationService();
    expect(() => svc.validate()).toThrow(/ENCRYPTION_KEY/);
  });

  it('reports all validation errors at once (abortEarly: false)', () => {
    // Omit two required fields
    const env = { ...VALID_ENV };
    delete env.DATABASE_HOST;
    delete env.JWT_SECRET;
    Object.assign(process.env, env);
    const svc = new ConfigValidationService();
    let errorMessage = '';
    try {
      svc.validate();
    } catch (e: any) {
      errorMessage = e.message;
    }
    expect(errorMessage).toMatch(/DATABASE_HOST/);
    expect(errorMessage).toMatch(/JWT_SECRET/);
  });

  it('onModuleInit delegates to validate', () => {
    Object.assign(process.env, VALID_ENV);
    const svc = new ConfigValidationService();
    const spy = jest.spyOn(svc, 'validate');
    svc.onModuleInit();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
