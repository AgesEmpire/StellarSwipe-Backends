import { developmentConfig } from './environments/development';
import { testnetConfig } from './environments/testnet';
import { mainnetConfig } from './environments/mainnet';
import { Configuration } from './schemas/config.interface';

/**
 * Parse a positive integer from an environment variable.
 * Returns the fallback when the value is missing or not a valid positive integer.
 */
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

/**
 * Request payload and parameter size limits (issue #1166).
 * All limits are configurable via environment variables and enforced
 * consistently across transports before expensive processing occurs.
 */
const requestLimits = {
  jsonBody: parsePositiveInt(process.env.REQUEST_LIMIT_JSON_BODY, 1 * 1024 * 1024),
  multipartUpload: parsePositiveInt(process.env.REQUEST_LIMIT_MULTIPART_UPLOAD, 10 * 1024 * 1024),
  queryString: parsePositiveInt(process.env.REQUEST_LIMIT_QUERY_STRING, 2 * 1024),
  headers: parsePositiveInt(process.env.REQUEST_LIMIT_HEADERS, 8 * 1024),
  routeParameter: parsePositiveInt(process.env.REQUEST_LIMIT_ROUTE_PARAMETER, 256),
};

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

  return {
    ...envConfig,
    requestLimits,
  };
};
