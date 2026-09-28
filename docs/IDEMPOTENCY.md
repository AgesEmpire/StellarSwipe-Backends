# Idempotency Keys for Mutating Endpoints

Applies to selected `POST` endpoints (currently trade execution in
`TradesController` and signal creation in `SignalsController`). Clients opt in
by sending an `Idempotency-Key` header.

## How it works

1. `RequireIdempotencyKeyGuard` rejects the request with `400 Bad Request` if
   the header is missing, empty, or over 255 characters.
2. `IdempotencyInterceptor` looks up the response cache using a key built from
   **tenant + user + HTTP method + route + Idempotency-Key**.
   - **Cache hit, same request body** (compared by SHA-256 hash): the cached
     response is returned immediately; the handler does not run again, so the
     side effect (trade execution, signal creation, etc.) happens exactly
     once.
   - **Cache hit, different request body**: the request is rejected with
     `409 Conflict` — reusing a key for a different operation is treated as a
     client error, not silently accepted.
   - **Cache miss**: the handler runs, and its response is stored before
     being returned.

## Persistence

Responses are persisted in the shared Redis-backed cache (`CACHE_MANAGER`,
configured in `CacheModule` via `cache-manager-redis-yet`), so replay works
across instances and process restarts, not just within one node. An in-memory
`Map` is used only as a fallback when the interceptor is constructed outside
Nest's DI container (e.g. in isolated unit tests).

## Expiration

Cached responses expire after **24 hours** (`DEFAULT_TTL_MS` in
`idempotency.interceptor.ts`). After expiry, a repeated request with the same
key is treated as a new operation and executes the handler again.

## Tenant scoping

The cache key includes the tenant ID resolved from the async-local tenant
context (`getCurrentTenantIdOrNull()` in `src/tenancy/tenant-context.ts`, falling
back to `request.user.tenantId`), followed by the user ID. This guarantees the
same `Idempotency-Key` value sent by two different tenants — even if their
user IDs happened to collide — is tracked independently and can never replay
or conflict across tenant boundaries. Requests with no resolvable tenant
context fall back to a shared `no-tenant` scope.

## Concurrent requests

Two concurrent requests carrying the same key are handled at two layers:

- `RequireIdempotencyKeyGuard` tracks keys whose first request is still
  in-flight in a process-local `Set`. A second request for the same key while
  the first is still running is rejected immediately with `409 Conflict` and
  a `Retry-After: 2` header — the caller is expected to retry shortly rather
  than wait.
- `IdempotencyInterceptor` additionally serialises concurrent executions that
  reach it for the same cache key (an in-flight `Promise` map): if the guard
  isn't present on a given route, the second request awaits and shares the
  first request's result instead of re-running the handler.

## Adding idempotency to a new endpoint

```ts
@UseInterceptors(IdempotencyInterceptor) // controller or method level
export class MyController {
  @Post()
  @UseGuards(RequireIdempotencyKeyGuard) // enforce the header is present
  @Idempotent() // documents the header in Swagger
  async create(@Body() dto: CreateDto) { ... }
}
```

`IdempotentStartupCheck` fails application startup if `@Idempotent()` is used
without `IdempotencyInterceptor` wired via `@UseInterceptors`, preventing a
route from documenting idempotency support it doesn't actually have.
