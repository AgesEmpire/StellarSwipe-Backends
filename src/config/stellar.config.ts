import { registerAs } from '@nestjs/config';
import { StellarConfig } from './schemas/config.interface';

export const stellarConfig = registerAs(
  'stellar',
  (): StellarConfig => {
    const network = (process.env.STELLAR_NETWORK || 'testnet') as
      | 'testnet'
      | 'public';

    // Determine URLs based on network
    const isPublic = network === 'public';
    const horizonUrl =
      process.env.STELLAR_HORIZON_URL ||
      (isPublic
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org');
    const sorobanRpcUrl =
      process.env.STELLAR_SOROBAN_RPC_URL ||
      (isPublic
        ? 'https://soroban-rpc.stellar.org'
        : 'https://soroban-testnet.stellar.org');
    const networkPassphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE ||
      (isPublic
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015');

    return {
      network,
      horizonUrl,
      sorobanRpcUrl,
      networkPassphrase,
      apiTimeout: parseInt(process.env.STELLAR_API_TIMEOUT || '30000', 10),
      maxRetries: parseInt(process.env.STELLAR_MAX_RETRIES || '3', 10),
      maxCallDepth: parseInt(process.env.STELLAR_MAX_CALL_DEPTH || '5', 10),
      maxCallDepthViolationPolicy: (process.env.STELLAR_MAX_CALL_DEPTH_POLICY as 'reject' | 'warn') || 'reject',
      // Bulkhead isolation for Horizon API calls. Read and write categories get
      // dedicated, bounded concurrency pools so a degraded category cannot
      // exhaust the shared request pool and starve the other.
      horizonBulkhead: {
        read: {
          maxConcurrent: parseInt(
            process.env.STELLAR_HORIZON_READ_MAX_CONCURRENT || '20',
            10,
          ),
          maxQueue: parseInt(
            process.env.STELLAR_HORIZON_READ_MAX_QUEUE || '100',
            10,
          ),
        },
        write: {
          maxConcurrent: parseInt(
            process.env.STELLAR_HORIZON_WRITE_MAX_CONCURRENT || '5',
            10,
          ),
          maxQueue: parseInt(
            process.env.STELLAR_HORIZON_WRITE_MAX_QUEUE || '25',
            10,
          ),
        },
      },
    };
  },
);
