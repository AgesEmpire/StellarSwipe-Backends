import { developmentConfig } from './environments/development';
import { testnetConfig } from './environments/testnet';
import { mainnetConfig } from './environments/mainnet';
import { Configuration } from './schemas/config.interface';

/**
 * Get environment-specific configuration
 * This merges base configuration with environment-specific overrides
 */
export default (): Partial<Configuration> => {
  const nodeEnv = process.env.NODE_ENV || 'development';

  let envConfig: Partial<Configuration> = {};

  switch (nodeEnv) {
    case 'development':
      envConfig = developmentConfig;
      break;
    case 'testnet':
      envConfig = testnetConfig;
      break;
    case 'mainnet':
      envConfig = mainnetConfig;
      break;
    default:
      envConfig = developmentConfig;
  }

  return envConfig;
};
