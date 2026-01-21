import { Configuration } from '../schemas/config.interface';

export const developmentConfig: Partial<Configuration> = {
  app: {
    port: 3000,
    environment: 'development',
    host: 'localhost',
    apiPrefix: 'api',
    apiVersion: 'v1',
    logLevel: 'debug',
    logDirectory: './logs',
    logMaxFiles: '14d',
    logMaxSize: '20m',
    corsOrigin: ['http://localhost:3000', 'http://localhost:5173'],
    corsCredentials: true,
  },
  stellar: {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    apiTimeout: 30000,
    maxRetries: 3,
  },
};
