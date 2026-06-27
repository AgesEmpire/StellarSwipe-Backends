# Position Archival to Cold Storage

## Overview

This implementation adds a comprehensive archival system for closed positions older than a configurable retention window. Position and trade history data accumulates indefinitely in the primary database, and this feature moves old, closed positions to cold storage while preserving queryability for compliance and export purposes.

## Changes Made

### 1. New Entity: `ArchivedPosition` (`src/portfolio/entities/archived-position.entity.ts`)

Created a new TypeORM entity that serves as the cold storage destination for archived positions. This entity:
- Stores all relevant position data including user_id, trade_id, assets, entry/exit prices, and P&L
- Tracks archival metadata: `closed_at` (when position closed), `archived_at` (when archived)
- Uses nullable columns to support both regular positions and copied positions
- Includes database indexes for efficient querying by user and archival date

### 2. New Service: `PositionArchiveService` (`src/portfolio/services/position-archive.service.ts`)

Core archival service with methods:

- **`archiveClosedPositions(retentionDays?)`**: Identifies and archives `Position` entities where `isActive = false` and `updatedAt` is older than the retention window
- **`archiveClosedCopiedPositions(retentionDays?)`**: Archives `CopiedPosition` entities with `status = CLOSED` older than retention window
- **`getArchivedPositions(userId, startDate?, endDate?)`**: Retrieves archived positions for compliance/export queries
- **`restoreArchivedPosition(archivedPositionId)`**: Restores an archived position back to the hot table if needed

### 3. New Scheduled Job: `PositionArchiveJob` (`src/portfolio/jobs/position-archive.job.ts`)

Scheduled job that runs daily at 3 AM UTC to:
- Execute position archival for both regular and copied positions
- Log archival statistics (number of archived records)

Cron schedule configurable via `CRON_POSITION_ARCHIVE` environment variable.

### 4. Updated ETL System

Modified the existing data lake ETL pipeline to include archived positions:

- **`PositionsExtractor`** (`src/data-lake/etl/extractors/positions.extractor.ts`): New extractor for archived positions
- **`EtlOrchestratorService`**: Added positions to retention policies (5 years/1825 days) and ETL pipeline
- **`EtlJobType`**: Added `POSITIONS` type enum value
- **`DataLakeModule`**: Registered PositionsExtractor provider

### 5. Updated Export Functionality

Modified `ExportService` to merge active trades and archived positions for complete export history:

- Queries both `trade` and `archived_positions` tables
- Merges results into unified position history format
- Supports CSV and JSON export formats
- Maintains backward compatibility with existing export endpoints

### 6. Unit Tests

Created comprehensive tests in:
- `src/portfolio/services/position-archive.service.spec.ts`: Tests for archival selection, duplicate handling, retrieval, and restoration
- `src/data-lake/etl/extractors/positions.extractor.spec.ts`: Tests for position extraction from cold storage

### 7. Configuration Updates

Added new environment variables to `.env.example`:
- `POSITION_ARCHIVE_RETENTION_DAYS=90`: Days before closed positions are archived
- `CRON_POSITION_ARCHIVE=0 3 * * *`: Schedule for the archival job

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│  positions (hot)    │────▶│ archived_positions   │
│  isActive=false     │     │ (cold storage)       │
│  old updatedAt        │     │                      │
└─────────────────────┘     └──────────────────────┘
                                   ▲
                                   │
┌─────────────────────┐     ┌─────┴───────────────┐
│  copied_positions   │────▶│ PositionArchiveJob  │
│  (hot)                │     │ (scheduled)          │
└─────────────────────┘     └─────────────────────┘
                                   │
                                   ▼
        ┌────────────────────────────────────────┐
        │     Export / Compliance Endpoints      │
        │  (merged query hot + cold storage)     │
        └────────────────────────────────────────┘
```

## Retention Policy

| Data Type | Hot Storage Retention | Cold Storage Retention |
|-----------|----------------------|---------------------|
| Positions | 90 days (configurable) | Indefinite |
| Trades | Primary table | 730 days (data lake) |
| Copied Positions | 90 days (configurable) | Indefinite |

## Usage

### Manual Archival Trigger

```typescript
// In application code
const result = await positionArchiveService.archiveClosedPositions(90);
console.log(`Archived ${result.archived} positions`);
```

### Export Including Archived Data

```typescript
// Export endpoint automatically includes archived positions
const exportResult = await exportService.exportTrades(userId, {
  format: ExportFormat.CSV,
  startDate: '2023-01-01',
  endDate: '2024-06-01',
});
```

### Compliance Query

```typescript
// Retrieve archived positions directly
const archived = await positionArchiveService.getArchivedPositions(userId, startDate, endDate);
```

## Testing

Run tests with:
```bash
npm test -- position-archive.service.spec.ts
npm test -- positions.extractor.spec.ts
```

## Compliance Considerations

- Archived data remains fully queryable via existing endpoints
- Retention periods align with regulatory requirements (5 years for positions)
- Data integrity maintained through atomic archival operations
- Audit trail preserved with `archived_at` timestamps

closes #793