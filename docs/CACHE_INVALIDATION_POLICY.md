# Cache Invalidation Policy

Defines consistent invalidation rules for the three cache scopes used across the
NestJS backend, to prevent stale reads and cache stampedes.

See [`src/cache/invalidation/cache-invalidation.policy.ts`](../src/cache/invalidation/cache-invalidation.policy.ts).

| Scope  | TTL   | Jitter | Recompute Lock | Invalidating Events |
|--------|-------|--------|-----------------|----------------------|
| global | 300s  | ±30s   | yes             | config.updated, feature-flag.updated, market-data.refreshed |
| tenant | 120s  | ±15s   | yes             | tenant.settings.updated, tenant.plan.changed, tenant.member.updated |
| user   | 60s   | ±5s    | no              | user.profile.updated, user.permissions.updated, user.logout |

## Why jitter + recompute locks

- **Jitter** spreads out TTL expiry so many keys don't expire at the same instant,
  reducing the odds of a thundering-herd cache stampede.
- **Recompute lock** (global/tenant scopes) ensures only one process recomputes a
  cold/expired value at a time; other callers wait for or serve the last-known value
  instead of all hitting the origin store simultaneously.

## Key isolation

Tenant and user keys are namespaced with their scope id (`cache:tenant:<tenantId>:...`,
`cache:user:<userId>:...`) via `buildScopedCacheKey`, guaranteeing tenant/user boundary
isolation and preventing cross-tenant or cross-user stale reads.

## Observability

Emit a cache event (hit/miss/invalidate) tagged with `scope` and `keyPrefix` from
existing cache instrumentation (see `src/cache/monitoring/cache-metrics.service.ts`)
so staleness and stampede risk can be tracked per scope in dashboards/alerts.
