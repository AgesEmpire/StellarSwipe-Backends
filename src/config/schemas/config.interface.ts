export interface AppConfig {
  port: number;
  environment: 'development' | 'testnet' | 'mainnet';
  host: string;
  apiPrefix: string;
  apiVersion: string;
  logLevel: string;
  logDirectory: string;
  logMaxFiles: string;
  logMaxSize: string;
  corsOrigin: string[];
  corsCredentials: boolean;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
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
