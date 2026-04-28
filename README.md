# StellarSwipe Backend

A robust NestJS backend for StellarSwipe, integrating Stellar's blockchain infrastructure with Soroban smart contract support.

## Project Structure

```
src/
├── config/              # Configuration modules
│   ├── stellar.config.ts     # Stellar blockchain configuration
│   ├── stellar.service.ts    # Stellar configuration service
│   ├── database.config.ts    # Database and Redis configuration
│   └── app.config.ts         # Application configuration
├── common/              # Shared utilities
│   ├── constants/       # Application constants
│   ├── decorators/      # Custom decorators (IsPublic, RateLimit)
│   ├── filters/         # Global exception filter
│   └── interceptors/    # Logging and transform interceptors
├── main.ts              # Application bootstrap
└── app.module.ts        # Root module
```

## Prerequisites

- Node.js 18+
- npm 9+
- Docker & Docker Compose (optional, for containerized development)
- PostgreSQL (or use Docker)
- Redis (or use Docker)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd stellarswipe-backend
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

## Environment Configuration

Key environment variables:

### Application

- `NODE_ENV`: development | production
- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: 0.0.0.0)
- `LOG_LEVEL`: debug | info | warn | error

### Database (PostgreSQL)

- `DATABASE_HOST`: Database host
- `DATABASE_PORT`: Database port (default: 5432)
- `DATABASE_USER`: Database user
- `DATABASE_PASSWORD`: Database password
- `DATABASE_NAME`: Database name

### Cache (Redis)

- `REDIS_HOST`: Redis host
- `REDIS_PORT`: Redis port (default: 6379)
- `REDIS_PASSWORD`: Redis password (optional)

### Stellar Blockchain

- `STELLAR_NETWORK`: testnet | mainnet (default: testnet)
- `STELLAR_HORIZON_URL`: Horizon API URL
- `STELLAR_SOROBAN_RPC_URL`: Soroban RPC endpoint
- `STELLAR_NETWORK_PASSPHRASE`: Network passphrase for signing
- `STELLAR_API_TIMEOUT`: API timeout in ms (default: 30000)
- `STELLAR_MAX_RETRIES`: Max API retries (default: 3)

### CORS

- `CORS_ORIGIN`: Comma-separated allowed origins
- `CORS_CREDENTIALS`: Enable credentials (default: true)

## Development

### Without Docker

Start development server:

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000/api/v1`

### With Docker

Start all services:

```bash
docker-compose up -d
```

This starts:

- **PostgreSQL**: Port 5432
- **Redis**: Port 6379
- **NestJS App**: Port 3000

View logs:

```bash
docker-compose logs -f app
```

Stop services:

```bash
docker-compose down
```

## Available Commands

```bash
# Development
npm run start:dev          # Watch mode
npm run start:debug        # Debug mode
npm start                  # Production mode

# Build
npm run build              # Compile TypeScript

# Code Quality
npm run lint               # Run ESLint
npm run lint:fix           # Fix linting issues
npm run format             # Format code with Prettier

# Testing
npm test                   # Run tests
npm run test:watch         # Watch mode
npm run test:cov           # Coverage report
npm run test:debug         # Debug tests
```

## Stellar Integration

### Horizon API (Testnet)

```
https://horizon-testnet.stellar.org
```

### Soroban RPC (Testnet)

```
https://soroban-testnet.stellar.org:443
```

### Network Configuration

**Testnet** (default):

- Network Passphrase: `Test SDF Network ; September 2015`
- Horizon: `https://horizon-testnet.stellar.org`
- Soroban RPC: `https://soroban-testnet.stellar.org:443`

**Mainnet** (when ready):

- Network Passphrase: `Public Global Stellar Network ; September 2015`
- Horizon: `https://horizon.stellar.org`
- Soroban RPC: `https://soroban-mainnet.stellar.org:443`

## API Structure

### Global Configuration

- **Global Prefix**: `/api/v1`
- **Exception Filter**: Catches all errors and formats responses
- **Interceptors**: Logging and response transformation
- **Validation**: Automatic DTO validation

### Common Response Format

Success response:

```json
{
  "success": true,
  "data": {
    /* response data */
  },
  "timestamp": "2026-01-19T12:00:00.000Z"
}
```

Error response:

```json
{
  "statusCode": 400,
  "message": "Error message",
  "timestamp": "2026-01-19T12:00:00.000Z",
  "path": "/api/v1/endpoint"
}
```

## Code Quality

### ESLint Configuration

- TypeScript strict mode enabled
- No unused variables allowed
- Prettier integration for automatic formatting

### Prettier Formatting

- Semi-colons enabled
- Single quotes
- 80 character line width
- 2-space indentation

Check formatting:

```bash
npm run lint
npm run format
```

## Database

### TypeORM Integration

- Configured with PostgreSQL
- Migrations support
- Automatic synchronization in development
- SSL support for production

### Migrations

Create migration:

```bash
npm run typeorm migration:create src/migrations/CreateUsersTable
```

Run migrations:

```bash
npm run typeorm migration:run
```

## Testing

### Jest Configuration

- TypeScript support via `ts-jest`
- Coverage reporting

Run tests:

```bash
npm test
npm run test:watch
npm run test:cov
```

## Production Deployment

### Build

```bash
npm run build
```

### Docker Image

```bash
docker build -t stellarswipe-backend:latest .
docker run -p 3000:3000 --env-file .env stellarswipe-backend:latest
```

### Environment Setup

1. Set `NODE_ENV=production`
2. Configure all required environment variables
3. Use strong database password
4. Set Redis password
5. Configure CORS appropriately

## Troubleshooting

### Connection Issues

- Ensure PostgreSQL is running on configured host/port
- Ensure Redis is running and accessible
- Check network connectivity to Stellar endpoints

### Module Not Found

```bash
npm install
npm run build
```

### Port Already in Use

```bash
# Change PORT in .env or kill existing process
lsof -i :3000
kill -9 <PID>
```

## Contributing

1. Create feature branch: `git checkout -b feature/new-feature`
2. Commit changes: `git commit -am 'Add new feature'`
3. Push to branch: `git push origin feature/new-feature`
4. Submit Pull Request

## Documentation

### Dependencies

- **@nestjs/common**: NestJS core functionality
- **@nestjs/config**: Environment configuration management
- **@stellar/stellar-sdk**: Stellar blockchain SDK
- **@soroban-js/stellar-sdk**: Soroban smart contract SDK
- **typeorm**: ORM for database operations
- **ioredis**: Redis client
- **class-validator**: DTO validation

### Dev Dependencies

- **typescript**: 5.3.3
- **@nestjs/cli**: NestJS CLI tools
- **eslint**: Code linting
- **prettier**: Code formatting
- **jest**: Testing framework

## License

MIT

