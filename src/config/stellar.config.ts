import { registerAs } from '@nestjs/config';
import { StellarConfig } from './schemas/config.interface';

export const stellarConfig = registerAs(
  'stellar',
  (): StellarConfig => {
    const network = (process.env.STELLAR_NETWORK || 'testnet') as
      | 'testnet'
      | 'mainnet';

    // Determine URLs based on network
    const isMainnet = network === 'mainnet';
    const horizonUrl =
      process.env.STELLAR_HORIZON_URL ||
      (isMainnet
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org');
    const sorobanRpcUrl =
      process.env.STELLAR_SOROBAN_RPC_URL ||
      (isMainnet
        ? 'https://soroban-rpc.stellar.org'
        : 'https://soroban-testnet.stellar.org');
    const networkPassphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE ||
      (isMainnet
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015');

    return {
      network,
      horizonUrl,
      sorobanRpcUrl,
      networkPassphrase,
      apiTimeout: parseInt(process.env.STELLAR_API_TIMEOUT || '30000', 10),
      maxRetries: parseInt(process.env.STELLAR_MAX_RETRIES || '3', 10),
    };
  },
);
