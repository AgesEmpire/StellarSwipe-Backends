# Configuration Module

This directory contains the configuration management system for StellarSwipe Backend.

## Structure

```
config/
├── schemas/
│   ├── config.interface.ts    # TypeScript interfaces for type safety
│   └── config.schema.ts        # Joi validation schema
├── environments/
│   ├── development.ts          # Development environment defaults
│   ├── testnet.ts             # Testnet environment defaults
│   └── mainnet.ts             # Mainnet environment defaults
├── configuration.ts            # Environment orchestrator
├── app.config.ts              # Application configuration
├── database.config.ts         # Database & Redis configuration
├── stellar.config.ts          # Stellar network configuration
├── jwt.config.ts              # JWT authentication configuration
└── stellar.service.ts         # Stellar configuration service wrapper
```

## Files Description

### schemas/

- **config.interface.ts**: TypeScript interfaces that define the shape of configuration objects for type safety
- **config.schema.ts**: Joi validation schema that validates environment variables on application startup

### environments/

Environment-specific configuration files that provide default values based on the deployment environment:

- **development.ts**: Local development settings (debug logging, localhost CORS, testnet)
- **testnet.ts**: Staging environment settings (info logging, restricted CORS, testnet)
- **mainnet.ts**: Production settings (warn logging, strict CORS, mainnet)

### Configuration Modules

- **configuration.ts**: Orchestrates environment-specific configs based on `NODE_ENV`
- **app.config.ts**: Application settings (port, host, API prefix, logging, CORS, Sentry)
- **database.config.ts**: PostgreSQL and Redis connection settings
- **stellar.config.ts**: Stellar network configuration (Horizon URL, Soroban RPC, network passphrase)
- **jwt.config.ts**: JWT authentication settings (secret, expiration)
- **stellar.service.ts**: Injectable service that wraps Stellar configuration with helper methods

## Usage

### Accessing Configuration

```typescript
import { ConfigService } from '@nestjs/config';

constructor(private configService: ConfigService) {}

// Get specific value
const port = this.configService.get<number>('app.port');
const dbHost = this.configService.get<string>('database.host');
```

### Using Stellar Config Service

```typescript
import { StellarConfigService } from './config/stellar.service';

constructor(private stellarConfig: StellarConfigService) {}

// Helper methods
if (this.stellarConfig.isMainnet()) {
  // Production logic
}

const horizonUrl = this.stellarConfig.horizonUrl;
```

## Environment Variables

Configuration is loaded from environment variables via `.env` files:

- `.env.development` - Development environment
- `.env.testnet` - Testnet environment
- `.env.mainnet` - Mainnet environment
- `.env` - Fallback/override file

See [CONFIGURATION.md](../../docs/CONFIGURATION.md) for complete documentation.

## Validation

The configuration schema validates:

- Required fields are present
- Values are of correct type
- Enums match allowed values
- Strings meet length requirements
- URLs are valid

If validation fails, the application will not start.

## Adding New Configuration

1. **Define interface** in `schemas/config.interface.ts`:
```typescript
export interface MyConfig {
  myField: string;
}
```

2. **Add validation** in `schemas/config.schema.ts`:
```typescript
MY_FIELD: Joi.string().required(),
```

3. **Create config module** (e.g., `my.config.ts`):
```typescript
import { registerAs } from '@nestjs/config';
import { MyConfig } from './schemas/config.interface';

export const myConfig = registerAs('my', (): MyConfig => ({
  myField: process.env.MY_FIELD || 'default',
}));
```

4. **Register in app.module.ts**:
```typescript
load: [..., myConfig],
```

5. **Update environment files** and `.env.example`

## Best Practices

- Never commit `.env` files with secrets
- Always add new variables to `.env.example`
- Use type-safe interfaces for configuration access
- Provide sensible defaults where possible
- Validate all required configuration on startup
- Use environment-specific files for different deployments
