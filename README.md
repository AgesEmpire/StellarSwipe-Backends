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
2. Commit changes using the [Conventional Commits](https://www.conventionalcommits.org/) format, e.g. `git commit -m 'feat(trades): add new feature'`
3. Push to branch: `git push origin feature/new-feature`
4. Submit Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full commit message format,
allowed types, and examples.

### Git hooks (commitlint + Husky)

[Husky](https://typicode.github.io/husky/) git hooks are installed automatically
when you run `npm install` (via the `prepare` script):

- **`commit-msg`** — runs [commitlint](https://commitlint.js.org/) to reject any
  commit message that doesn't follow the Conventional Commits format.
- **`pre-push`** — runs `npm run lint` and `npm run test:smoke` before a push is
  allowed.

You can bypass hooks in an emergency with `git commit --no-verify` /
`git push --no-verify`.

## Releases & Changelog

This project follows [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, etc.) for commit messages. `CHANGELOG.md` is generated automatically from this commit history using [`conventional-changelog-cli`](https://github.com/conventional-changelog/conventional-changelog).

### Automated releases (semantic-release)

The `.github/workflows/release.yml` workflow runs **semantic-release** automatically on every push to `main`. It:

1. Analyzes commit messages since the last tag to determine the next semantic version (`patch` / `minor` / `major`).
2. Bumps `package.json` version and prepends an entry to `CHANGELOG.md`.
3. Creates a git tag (e.g. `v1.2.0`) and a GitHub Release with generated notes.
4. Commits the updated `package.json` and `CHANGELOG.md` back to `main`.

Required repository secret: `GITHUB_TOKEN` (provided automatically by GitHub Actions).

#### Dry-run mode

To verify what semantic-release would do **without publishing** anything:

```bash
npx semantic-release --dry-run
```

Set `CI=true` in your shell if running outside of a CI environment. The dry-run prints the computed next version and release notes without creating tags, commits, or a GitHub Release.

### Generating the changelog manually

When cutting a release manually:

1. Make sure commit messages since the last release follow the Conventional Commits format. Use a `BREAKING CHANGE:` footer (or a `!` after the type/scope, e.g. `feat!:`) for any breaking change — these are surfaced in their own dedicated section of the changelog.
2. Run:

   ```bash
   npm run changelog
   ```

   This parses commits since the last git tag (or the full history if no tag exists yet) and prepends a categorized entry (Features, Bug Fixes, Breaking Changes, etc.) to the top of `CHANGELOG.md`. If `CHANGELOG.md` does not exist, it will be created.
3. Review the generated entry, then commit it together with the version bump:

   ```bash
   git add CHANGELOG.md
   git commit -m "chore(release): update changelog"
   ```
4. Tag the release (e.g. `git tag v1.2.0`) so the next changelog run only picks up commits made after this point.

To regenerate the changelog for the entire commit history from scratch (e.g. to fix formatting), use:

```bash
npm run changelog:init
```

This rewrites `CHANGELOG.md` from the very first commit instead of appending only the new entries.

## Dependency Vulnerability Scanning

The `.github/workflows/audit.yml` workflow runs `npm audit --audit-level=high` on every PR and push to `main`, and on a daily schedule. The build **fails** when any high or critical severity vulnerability is introduced.

### Handling findings

- **Fix it** — upgrade the affected package or its parent dependency.
- **Accept the risk** — if no fix is available (e.g. a transitive dependency you don't control), add the advisory ID to `.auditignore` with a mandatory comment explaining the reason and a review-by date. See `.auditignore` for the required format.

Do **not** use `--force` or blanket-ignore the entire scan. Every suppression must be justified individually.

## Module Dependency Graph

Regenerate the NestJS module dependency graph at any time:

```bash
npm run docs:module-graph
```

This scans all `*.module.ts` files under `src/`, extracts `@Module` `imports` arrays, and writes a Mermaid diagram to `docs/module-graph.md`.

The script exits with code `1` and prints the offending cycles if circular module dependencies are detected. Circular nodes are highlighted in red in the generated diagram.

### What to do when circular dependencies are found

1. Look at the printed cycle (e.g. `A → B → C → A`).
2. Extract the shared logic into a new `CommonModule` that both modules can import without creating a cycle.
3. Re-run `npm run docs:module-graph` to confirm the cycle is gone.

## Docker Compose Dev Profiles

The `docker-compose.yml` defines profiles so you can start only the services a given module needs instead of the full stack.

| Profile | Services started | Use case |
|---------|-----------------|----------|
| *(none — default)* | app + postgres + redis | Full local development |
| `db-only` | postgres | DB-focused module tests |
| `cache-only` | redis | Cache / session module tests |

```bash
# Full stack (default)
docker-compose up -d

# Postgres only
docker-compose --profile db-only up -d

# Redis only
docker-compose --profile cache-only up -d
```

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

