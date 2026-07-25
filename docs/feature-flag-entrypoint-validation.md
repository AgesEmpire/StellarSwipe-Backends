# Feature Flag Entrypoint Validation

## Overview

Feature flags and contract-entrypoint-scoped kill-switches reference specific module or contract entrypoint names as configuration values, but there was no validation ensuring a flag's referenced target still exists after refactors or contract redeployments. This implementation adds a scheduled background job that continuously validates feature flags against the known contract entrypoint registry, flagging dead references before they silently do nothing in production.

## Issues Resolved

- ✅ **#797** - Implement background job validating feature flags reference an entrypoint that still exists

## 🚀 Features Implemented

### 1. Contract Entrypoint Registry
**Files Added:**
- `src/feature-flags/constants/contract-entrypoints.registry.ts`

**Purpose:**
- Central source of truth for all known contract entrypoints
- Currently tracks `TradeExecutorContract` with methods: `execute_market_order`, `place_limit_order`, `cancel_order`, `get_order`
- Provides `isValidEntrypoint()` helper for O(1) lookup validation
- Designed for easy extension as new Soroban contracts are deployed

### 2. Feature Flag Entity Extension
**Files Modified:**
- `src/feature-flags/entities/feature-flag.entity.ts`

**New Columns Added:**
- `contractId?: string` — Optional reference to the target contract name
- `method?: string` — Optional reference to the specific entrypoint/method name
- `retired?: boolean` — Marks flags that are intentionally retired (safe to ignore during validation)

**Database Migration:**
- `src/database/migrations/1752700000000-AddEntrypointMetadataToFeatureFlags.ts`
  - Adds `contractId` (varchar, nullable)
  - Adds `method` (varchar, nullable)
  - Adds `retired` (boolean, default false)
  - Creates composite index on `(contractId, method)` for query performance

### 3. Background Validation Job
**Files Added:**
- `src/feature-flags/jobs/validate-feature-flag-entrypoints.job.ts`

**Files Modified:**
- `src/feature-flags/feature-flags.module.ts` — Imports `ScheduleModule` and registers the job provider
- `src/feature-flags/dto/create-flag.dto.ts` — Allows `contractId`, `method`, and `retired` in create/update DTOs

**Job Behavior:**
- **Schedule**: Runs daily at 02:00 UTC via `@Cron('0 2 * * *')`
- **Scope**: Queries all feature flags where both `contractId` and `method` are non-null
- **Validation Logic**:
  1. Flags marked `retired: true` are skipped and logged as "intentionally retired"
  2. Flags referencing a contract not in the registry are flagged as invalid
  3. Flags referencing a method not present on the known contract are flagged as invalid
  4. Valid flags are counted and reported
- **Reporting**:
  - `logger.warn` for each individual invalid flag with specific reason
  - `logger.error` with a consolidated list of all invalid flags
  - `logger.log` with summary counts (valid, retired, invalid)

**Example Log Output:**
```
[FeatureFlags] Feature flag "stale_entrypoint_test_fixture" references an invalid target: method "nonexistent_entrypoint" does not exist on contract "TradeExecutorContract"
[FeatureFlags] Feature flag entrypoint validation complete — valid: 1, retired: 1, invalid: 1
[FeatureFlags] Detected 1 feature flag(s) with missing entrypoints: stale_entrypoint_test_fixture
```

### 4. Test Fixture & Unit Tests
**Files Added:**
- `src/feature-flags/jobs/validate-feature-flag-entrypoints.job.spec.ts`

**Files Modified:**
- `src/database/seeds/feature-flags.seed.ts` — Added `stale_entrypoint_test_fixture` with `contractId: 'TradeExecutorContract'` and `method: 'nonexistent_entrypoint'`

**Test Coverage:**
- ✅ Detects flags with nonexistent entrypoints
- ✅ Skips retired flags without warning
- ✅ Passes validation for flags with known entrypoints
- ✅ Handles unknown contracts gracefully
- ✅ Handles empty flag set (no contract-scoped flags)

**Test Fixture Details:**
| Field | Value |
|-------|-------|
| `name` | `stale_entrypoint_test_fixture` |
| `type` | `boolean` |
| `enabled` | `false` |
| `contractId` | `TradeExecutorContract` |
| `method` | `nonexistent_entrypoint` |
| `retired` | `false` |

This fixture ensures the job detects invalid references in a real database state.

## 🔧 API / DTO Changes

### CreateFlagDto & UpdateFlagDto
Three new optional fields have been added:

```typescript
contractId?: string;  // e.g. "TradeExecutorContract"
method?: string;      // e.g. "execute_market_order"
retired?: boolean;    // true = intentionally retired, skip during validation
```

Existing flags without these fields are unaffected and continue to work normally.

## 🧪 Testing Strategy

The job is tested in isolation using NestJS's `Test.createTestingModule()` with mocked TypeORM repositories. The `@Cron` decorator is not triggered during tests; instead, the `run()` method is invoked directly.

Tests use `jest.spyOn` to mock logger methods and assert that:
- Correct warning/error messages are emitted for invalid flags
- Retired flags produce no warnings
- Summary logs reflect expected counts

## 🛡️ Production Considerations

- **Registry Updates**: When new contracts are deployed, `KNOWN_CONTRACT_ENTRYPOINTS` must be updated. This can be automated by parsing WASM metadata or ABI files in a future enhancement.
- **Retired Flags**: Teams should set `retired: true` on flags that are being phased out to avoid noise in validation reports.
- **CI Integration**: The job can also be triggered manually (outside its schedule) or adapted to run in CI pipelines by exposing a trigger endpoint.
- **Alerting**: The job currently logs errors; in production, these can be routed to alerting systems (PagerDuty, Slack) via the existing `DeadLetterService` or `JobsController`.

## 📦 Files Changed

```
src/database/migrations/1752700000000-AddEntrypointMetadataToFeatureFlags.ts  | NEW
src/database/seeds/feature-flags.seed.ts                                      | MODIFIED
src/feature-flags/constants/contract-entrypoints.registry.ts                  | NEW
src/feature-flags/dto/create-flag.dto.ts                                     | MODIFIED
src/feature-flags/entities/feature-flag.entity.ts                            | MODIFIED
src/feature-flags/feature-flags.module.ts                                    | MODIFIED
src/feature-flags/jobs/validate-feature-flag-entrypoints.job.spec.ts         | NEW
src/feature-flags/jobs/validate-feature-flag-entrypoints.job.ts              | NEW
```

## ✅ Verification Steps

1. Run database migrations: `npm run migration:run`
2. Seed the test fixture: `npm run seed`
3. Start the application: `npm run start:dev`
4. Verify the job runs at next scheduled interval (02:00 UTC) or trigger manually via the JobsController
5. Observe logs for the `stale_entrypoint_test_fixture` being flagged as invalid
6. Query `feature_flags` table to confirm new columns exist

## 🔗 Related

- closes #797
