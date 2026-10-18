export interface AppConfig {
  port: number;
  environment: 'development' | 'test' | 'testnet' | 'mainnet';
  host: string;
  apiPrefix: string;
  apiVersion: string;
  logLevel: string;
  logDirectory: string;
  logMaxFiles: string;
  logMaxSize: string;
  corsOrigin: string[];
  corsCredentials: boolean;
  slippageToleranceBps: number;
  shutdownDrainTimeoutMs: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  ssl?: {
    rejectUnauthorized: boolean;
  };
}

export interface HorizonBulkheadCategoryConfig {
  maxConcurrent: number;
  maxQueue: number;
}

export interface HorizonBulkheadConfig {
  read: HorizonBulkheadCategoryConfig;
  write: HorizonBulkheadCategoryConfig;
}

export interface StellarConfig {
  network: 'testnet' | 'public';
  horizonUrl: string;
  /**
   * Ordered list of Horizon endpoints to select among for health-aware
   * failover (#1373). Always includes `horizonUrl` as the first candidate;
   * additional endpoints come from `STELLAR_HORIZON_URLS`. Every endpoint
   * here must serve the same `network`/`networkPassphrase` — failover only
   * ever changes *which URL* is called, never which Stellar network the
   * request targets.
   */
  horizonUrls: string[];
  sorobanRpcUrl: string;
  networkPassphrase: string;
  apiTimeout: number;
  maxRetries: number;
  maxCallDepth: number;
  maxCallDepthViolationPolicy: 'reject' | 'warn';
  horizonBulkhead: HorizonBulkheadConfig;
}

export interface RedisConfig {
  host: string;
  port: number;
  db: number;
  password?: string;
  operationTimeoutMs?: number;
  policies?: { cache: string; session: string; rateLimit: string };
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export interface SentryConfig {
  dsn?: string;
  environment: string;
  tracesSampleRate: number;
}

export interface Configuration {
  app: AppConfig;
  database: DatabaseConfig;
  stellar: StellarConfig;
  redis: RedisConfig;
  jwt: JwtConfig;
  sentry: SentryConfig;
}
