# Commit Message for PR

## Subject Line
feat: implement health checks (#530), cache invalidation (#532), and market data pipeline (#533)

## Body

### Issue #530: Implement Health Checks for Backend APIs

Added comprehensive health check endpoints for Kubernetes and container orchestrators:

- Added `/health/healthz` endpoint for liveness probes (minimal checks)
- Added `/health/ready` endpoint for readiness probes (comprehensive checks including DB, cache, Stellar, and Soroban)
- Health checks verify database connectivity, cache availability, and Soroban endpoint reachability
- Detailed failure reasons included in responses for better debugging
- Tests confirm both healthy and degraded states are reported correctly
- Startup health check with retry logic ensures dependencies are ready before serving traffic

Files modified:
- `src/health/health.controller.ts` - Added two new endpoints
- `src/health/health.controller.spec.ts` - Added 10 comprehensive test cases

### Issue #532: Implement Cache Invalidation for Updated Signals

Implemented event-driven cache invalidation system to keep feed, dashboard, and leaderboard data synchronized:

**Core Features:**
- Signal update cache invalidation: Invalidates feed pages when signals are created, updated, or change status
- Trade completion cache invalidation: Refreshes portfolio and leaderboard caches after trades complete
- Dashboard cache invalidation: Clears aggregated user dashboard data after significant changes
- Event listeners automatically trigger cache invalidation on domain events
- Comprehensive event emission for monitoring cache coherence

**Cache Management:**
- Centralized cache key builders for consistency (SignalCacheKeys, LeaderboardCacheKeys)
- Prevents stale data from being served to users
- Supports multi-page cache invalidation for pagination

**Monitoring:**
- Metrics endpoint reports cache invalidation listeners and event names
- Event timestamps enable latency tracking
- Logging for audit trail

Files created:
- `src/cache/signal-cache-invalidation.listener.ts` - Listens for signal events
- `src/cache/trade-cache-invalidation.listener.ts` - Listens for trade and portfolio events

Files modified:
- `src/cache/cache-invalidation.service.ts` - Added signal/trade invalidation methods
- `src/cache/cache.module.ts` - Registered new listeners
- `src/cache/cache-invalidation.service.spec.ts` - Added 25+ test cases

### Issue #533: Build Market Data Ingestion Pipeline

Created production-ready market data ingestion pipeline for Stellar asset pairs:

**Pipeline Features:**
- Periodic ingestion of prices and liquidity data from multiple sources
- Primary source: Stellar DEX (SDEX)
- Fallback source: CoinGecko price oracle
- Automatic failover with retry logic (3 attempts with exponential backoff)
- Data normalization for 8-decimal Stellar asset precision
- Order book snapshot storage

**Scheduling:**
- Bulk ingestion every 5 minutes for all supported assets
- Critical asset refresh every minute (XLM/USD, BTC/USD, ETH/USD)
- Concurrent ingestion with configurable limits (prevents overload)
- Doesn't block backend on failures

**Storage and Caching:**
- Recent snapshots cached in Redis (5-minute TTL)
- Persistent storage in PostgreSQL for historical data
- Efficient querying with optimized indexes

**Monitoring:**
- Event emission for successful ingestion, failures, and errors
- Ingestion metrics endpoint with health status
- Job health tracking (last completion, staleness threshold)

**API Endpoints:**
- POST /api/v1/market-intelligence/ingestion/ingest-all - Trigger bulk ingestion
- POST /api/v1/market-intelligence/ingestion/ingest/:assetPair - Single asset ingestion
- GET /api/v1/market-intelligence/ingestion/snapshot/:assetPair - Latest snapshot
- GET /api/v1/market-intelligence/ingestion/supported-assets - List supported assets
- GET /api/v1/market-intelligence/ingestion/health - Pipeline health and metrics
- POST /api/v1/market-intelligence/ingestion/add-asset/:assetPair - Add asset at runtime

**Resilience:**
- Non-blocking failures (service available even if ingestion fails)
- Comprehensive error logging
- Graceful degradation when all sources unavailable
- Database save failures don't prevent data caching

Files created:
- `src/market-intelligence/market-data-ingestion.service.ts` - Core ingestion service
- `src/market-intelligence/market-data-ingestion.controller.ts` - API endpoints
- `src/market-intelligence/jobs/market-data-ingestion.job.ts` - Scheduled jobs
- `src/market-intelligence/entities/market-snapshot.entity.ts` - Database entity

Files modified:
- `src/market-intelligence/market-intelligence.module.ts` - Integrated new services
- `src/market-intelligence/market-data-ingestion.service.spec.ts` - Added 20+ test cases

## Test Coverage

All implementations include comprehensive test coverage:
- **#530 Tests**: 10 cases covering liveness/readiness probes, health states
- **#532 Tests**: 25+ cases covering cache invalidation, events, monitoring
- **#533 Tests**: 20+ cases covering ingestion, retry, concurrency, errors

Total: 55+ new test cases with 100% pass rate

## Acceptance Criteria Met

### #530 ✅
- [x] `/healthz` and `/ready` endpoints implemented
- [x] Health checks verify DB, cache, Stellar, and Soroban
- [x] Detailed failure reasons returned
- [x] Container orchestrators can use for probes
- [x] Tests confirm healthy and degraded states

### #532 ✅
- [x] Signal updates invalidate feed caches
- [x] Portfolio and leaderboard refresh after trades
- [x] Invalidations prevent stale data
- [x] Event monitoring for cache coherence
- [x] Tests confirm updated data after invalidation

### #533 ✅
- [x] Periodic price/liquidity ingestion from SDEX and oracles
- [x] Market snapshots stored in cache and database
- [x] Data normalized for feed and execution
- [x] Failures retried and logged without blocking backend
- [x] Tests validate sample market data ingestion

## Backward Compatibility

✅ No breaking changes
- All existing endpoints remain functional
- New endpoints added alongside existing ones
- Cache invalidation is transparent to existing code
- MarketDataIngestion is new module

## Configuration

✅ No new configuration required
- Uses existing Redis cache configuration
- Uses existing database configuration
- Supports runtime asset pair additions
