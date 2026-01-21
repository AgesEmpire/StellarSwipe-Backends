import { Configuration } from '../schemas/config.interface';

export const mainnetConfig: Partial<Configuration> = {
  app: {
    port: 3000,
    environment: 'mainnet',
    host: '0.0.0.0',
    apiPrefix: 'api',
    apiVersion: 'v1',
    logLevel: 'warn',
    logDirectory: './logs',
    logMaxFiles: '90d',
    logMaxSize: '100m',
    corsOrigin: [], // Will be overridden by environment variables
    corsCredentials: true,
  },
  stellar: {
    network: 'mainnet',
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://soroban-rpc.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    apiTimeout: 30000,
    maxRetries: 5,
  },
};
