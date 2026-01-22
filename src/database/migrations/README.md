# Database Migrations

This directory contains TypeORM migrations for the StellarSwipe database schema.

## Running Migrations

```bash
# Generate a new migration
npm run typeorm migration:generate -- -n MigrationName

# Run pending migrations
npm run typeorm migration:run

# Revert the last migration
npm run typeorm migration:revert
```

## Migration Files

- `1737561600000-CreateUserTables.ts` - Initial user schema with users, user_preferences, and sessions tables
