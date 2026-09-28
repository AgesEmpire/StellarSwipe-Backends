# Cache and database resilience

## Redis dependency policies

| Feature | Redis failure behavior | Request impact |
| --- | --- | --- |
| Ordinary cache reads/writes | Fail open | Read paths fetch from the database; writes continue without caching |
| Sessions and refresh tokens | Fail closed | Authentication returns `401` with a temporary-unavailable message |
| Rate limiting | Fail open | Requests continue and the degraded path is observable via `cache_fallbacks_total` |

Every cache operation is bounded by `REDIS_OPERATION_TIMEOUT_MS` (default 500 ms). Redis reconnect retries do not extend the request deadline. `cache_operation_timeouts_total` and `cache_fallbacks_total` support alerting; alert when either grows continuously or Redis health is down.

## Domain cache invalidation

Successful `trade.executed`, `trade.closed`, `transfer.completed`, and `portfolio.adjusted` events invalidate the affected tenant's:

- portfolio entry
- user rank and top-performers entries
- overall leaderboard pages 1-10
- asset leaderboard pages 1-10 when an asset pair is present

The key set is built centrally by `CacheInvalidationService`, deduplicated before deletion, and therefore safe to replay. Events must be emitted after the transaction commits. Rolled-back transactions must not emit these events; delayed delivery is safe because invalidation is idempotent.

## Market-data single flight

Concurrent misses for one key share one bounded fetch through `CacheService.getOrSetWithLock`. Waiters receive the same result. The in-flight fetch expires after the configured bounded window and is removed on success or failure. Cache hits, waiters, and failures are exposed through Prometheus counters.

## PostgreSQL timeouts

Primary pool defaults are 5 seconds for query cancellation and 10 seconds for statement execution. Replica reads use the 5-second policy. Override with `DATABASE_READ_TIMEOUT_MS`, `DATABASE_WRITE_TIMEOUT_MS`, `DATABASE_QUERY_TIMEOUT`, or `DATABASE_STATEMENT_TIMEOUT`. Timeout errors are mapped to HTTP 503 with a retryable, non-sensitive message. Pool connections are released by the PostgreSQL/TypeORM driver after cancellation; monitor pool active, idle, pending, and acquisition-timeout metrics during recovery.
