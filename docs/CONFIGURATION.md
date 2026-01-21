# Configuration Management Guide

## Overview

StellarSwipe Backend uses a robust, environment-specific configuration management system built on top of NestJS's `@nestjs/config` module with Joi schema validation. This ensures type-safe, validated configuration across all environments.

## Table of Contents

- [Environment Types](#environment-types)
- [Quick Start](#quick-start)
- [Configuration Structure](#configuration-structure)
- [Environment Variables](#environment-variables)
- [Type-Safe Access](#type-safe-access)
- [Validation](#validation)
- [Secrets Management](#secrets-management)
- [Environment Switching](#environment-switching)

## Environment Types

The application supports three environments:

- **development**: Local development with debug logging
- **testnet**: Staging environment using Stellar testnet
- **mainnet**: Production environment using Stellar public network

## Quick Start

### 1. Choose Your Environment

Copy the appropriate environment template:

```bash
# For local development
cp .env.development .env

# For testnet deployment
cp .env.testnet .env

# For mainnet deployment
cp .env.mainnet .env
```

### 2. Configure Required Variables

Edit your `.env` file and update the following **required** variables:

```bash
# Database
DATABASE_HOST=your-db-host
DATABASE_USER=your-db-user
DATABASE_PASSWORD=your-secure-password
DATABASE_NAME=your-db-name

# JWT Secret (IMPORTANT: Use a strong secret!)
# Generate with: openssl rand -base64 32
JWT_SECRET=your-secure-jwt-secret-minimum-32-characters-long

# Redis (if using)
REDIS_HOST=your-redis-host
REDIS_PASSWORD=your-redis-password
```

### 3. Start the Application

```bash
# Development
NODE_ENV=development npm run start:dev

# Testnet
NODE_ENV=testnet npm run start

# Mainnet
NODE_ENV=mainnet npm run start:prod
```

## Configuration Structure

```
src/config/
├── schemas/
│   ├── config.interface.ts    # TypeScript interfaces for type safety
│   └── config.schema.ts        # Joi validation schema
├── environments/
│   ├── development.ts          # Development-specific config
│   ├── testnet.ts             # Testnet-specific config
│   └── mainnet.ts             # Mainnet-specific config
├── configuration.ts            # Environment orchestration
├── app.config.ts              # Application configuration
├── database.config.ts         # Database & Redis configuration
├── stellar.config.ts          # Stellar network configuration
├── jwt.config.ts              # JWT configuration
└── stellar.service.ts         # Stellar config service wrapper
```

## Environment Variables

### Application Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | string | `development` | Environment: `development`, `testnet`, `mainnet` |
| `PORT` | number | `3000` | Server port |
| `HOST` | string | `0.0.0.0` | Server host |
| `API_PREFIX` | string | `api` | API route prefix |
| `API_VERSION` | string | `v1` | API version |

### Logging Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOG_LEVEL` | string | `debug` | Log level: `error`, `warn`, `info`, `debug`, `silly` |
| `LOG_DIRECTORY` | string | `./logs` | Log files directory |
| `LOG_MAX_FILES` | string | `14d` | Max log file retention |
| `LOG_MAX_SIZE` | string | `20m` | Max log file size |

### CORS Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CORS_ORIGIN` | string | `http://localhost:3000` | Comma-separated allowed origins |
| `CORS_CREDENTIALS` | boolean | `true` | Allow credentials |

### Database Configuration

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `DATABASE_HOST` | string | ✅ | PostgreSQL host |
| `DATABASE_PORT` | number | ❌ | PostgreSQL port (default: 5432) |
| `DATABASE_USER` | string | ✅ | Database username |
| `DATABASE_PASSWORD` | string | ✅ | Database password |
| `DATABASE_NAME` | string | ✅ | Database name |
| `DATABASE_LOGGING` | boolean | ❌ | Enable SQL logging |

### Redis Configuration

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `REDIS_HOST` | string | ✅ | Redis host |
| `REDIS_PORT` | number | ❌ | Redis port (default: 6379) |
| `REDIS_DB` | number | ❌ | Redis database index |
| `REDIS_PASSWORD` | string | ❌ | Redis password |

### Stellar Network Configuration

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `STELLAR_NETWORK` | string | ✅ | Network: `testnet` or `mainnet` |
| `STELLAR_HORIZON_URL` | string | ✅ | Horizon API URL |
| `STELLAR_SOROBAN_RPC_URL` | string | ✅ | Soroban RPC URL |
| `STELLAR_NETWORK_PASSPHRASE` | string | ✅ | Network passphrase |
| `STELLAR_API_TIMEOUT` | number | ❌ | API timeout in ms (default: 30000) |
| `STELLAR_MAX_RETRIES` | number | ❌ | Max retry attempts (default: 3) |

### JWT Configuration

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `JWT_SECRET` | string | ✅ | JWT signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | string | ❌ | Token expiration (default: 7d) |

### Sentry Configuration (Optional)

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `SENTRY_DSN` | string | ❌ | Sentry DSN for error tracking |
| `SENTRY_ENVIRONMENT` | string | ❌ | Environment name for Sentry |
| `SENTRY_TRACES_SAMPLE_RATE` | number | ❌ | Traces sample rate (0-1) |

## Type-Safe Access

### In Services and Controllers

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StellarConfig } from './config/schemas/config.interface';

@Injectable()
export class MyService {
  constructor(private configService: ConfigService) {}

  someMethod() {
    // Type-safe access to configuration
    const port = this.configService.get<number>('app.port');
    const stellarNetwork = this.configService.get<string>('stellar.network');

    // Get entire config object
    const dbConfig = this.configService.get<DatabaseConfig>('database');
  }
}
```

### Using StellarConfigService

```typescript
import { Injectable } from '@nestjs/common';
import { StellarConfigService } from './config/stellar.service';

@Injectable()
export class BlockchainService {
  constructor(private stellarConfig: StellarConfigService) {}

  async connect() {
    if (this.stellarConfig.isTestnet()) {
      console.log('Connecting to testnet');
    }

    const horizonUrl = this.stellarConfig.horizonUrl;
    // Use horizonUrl...
  }
}
```

## Validation

The configuration is validated on application startup using Joi schemas defined in [config.schema.ts](../src/config/schemas/config.schema.ts).

### Validation Rules

- `NODE_ENV` must be one of: `development`, `testnet`, `mainnet`
- `PORT` must be a valid number
- `DATABASE_*` fields are required
- `JWT_SECRET` must be at least 32 characters
- `STELLAR_NETWORK` must be either `testnet` or `mainnet`
- URLs must be valid URIs

### Validation Errors

If validation fails, the application will **not start** and will display detailed error messages:

```bash
Error: Config validation error:
- "JWT_SECRET" length must be at least 32 characters long
- "DATABASE_HOST" is required
```

## Secrets Management

### Development

For local development, secrets can be stored in `.env` files (which are gitignored).

### Production (Mainnet)

**Never commit secrets to version control!**

For production deployments, use a secrets management service:

#### AWS Secrets Manager (Recommended)

```typescript
// Example: Load secrets from AWS Secrets Manager
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManager({ region: 'us-east-1' });
const secret = await secretsManager.getSecretValue({
  SecretId: 'stellarswipe/production'
});
```

#### Environment Variables via CI/CD

Store secrets in your CI/CD platform:
- GitHub Actions: Use secrets
- GitLab CI: Use CI/CD variables
- Docker: Use secrets or environment files

## Environment Switching

### Local Development

```bash
# Switch to development
NODE_ENV=development npm run start:dev

# Switch to testnet (for testing)
NODE_ENV=testnet npm run start
```

### Docker

```bash
# Development
docker-compose up

# Testnet
NODE_ENV=testnet docker-compose up

# Mainnet
NODE_ENV=mainnet docker-compose -f docker-compose.prod.yml up
```

### Environment File Loading Priority

The application loads `.env` files in the following order (first match wins):

1. `.env.${NODE_ENV}` (e.g., `.env.development`)
2. `.env`

This allows you to:
- Keep a base `.env` file with common settings
- Override specific values with environment-specific files

## Network-Specific Configuration

### Development Environment

- **Stellar Network**: Testnet
- **Log Level**: Debug (verbose logging)
- **Database Sync**: Enabled (auto-create tables)
- **CORS**: Permissive (localhost origins)

### Testnet Environment

- **Stellar Network**: Testnet
- **Log Level**: Info
- **Database Sync**: Disabled (use migrations)
- **CORS**: Restricted (configured origins only)

### Mainnet Environment

- **Stellar Network**: Mainnet (Public)
- **Log Level**: Warn (errors and warnings only)
- **Database Sync**: Disabled (migrations only)
- **CORS**: Strict (production origins only)
- **SSL**: Enabled for database connections

## Troubleshooting

### Configuration Not Loading

1. Check that your `.env` file is in the project root
2. Verify `NODE_ENV` is set correctly
3. Check file permissions on `.env` file

### Validation Errors

1. Review error messages for missing or invalid variables
2. Compare your `.env` against `.env.example`
3. Ensure required variables are set

### Wrong Network

1. Check `STELLAR_NETWORK` value in `.env`
2. Verify corresponding URLs match the network
3. Restart the application after changes

## Best Practices

1. **Never commit secrets**: Always use `.gitignore` for `.env` files
2. **Use strong secrets**: Generate JWT secrets with `openssl rand -base64 32`
3. **Environment-specific configs**: Use appropriate `.env.*` templates
4. **Validate early**: Let the app fail fast on invalid config
5. **Document changes**: Update `.env.example` when adding new variables
6. **Rotate secrets**: Regularly rotate production secrets
7. **Use AWS Secrets Manager**: For production deployments
8. **Test environment switching**: Verify configs work in all environments

## Additional Resources

- [NestJS Configuration](https://docs.nestjs.com/techniques/configuration)
- [Joi Validation](https://joi.dev/api/)
- [Stellar Networks](https://developers.stellar.org/docs/networks)
- [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/)
