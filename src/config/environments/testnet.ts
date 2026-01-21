import { Configuration } from '../schemas/config.interface';

export const testnetConfig: Partial<Configuration> = {
  app: {
    port: 3000,
    environment: 'testnet',
    host: '0.0.0.0',
    apiPrefix: 'api',
    apiVersion: 'v1',
    logLevel: 'info',
    logDirectory: './logs',
    logMaxFiles: '30d',
    logMaxSize: '50m',
    corsOrigin: [], // Will be overridden by environment variables
    corsCredentials: true,
  },
  stellar: {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    apiTimeout: 30000,
    maxRetries: 5,
  },
};
