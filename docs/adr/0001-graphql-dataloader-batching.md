# ADR 0001: DataLoader-Based N+1 Query Prevention in GraphQL

**Status:** Accepted

**Date:** 2026-06-29

**Authors:** @StellarSwipe Team

## Context

The GraphQL API was experiencing N+1 query problems when resolving nested fields:
- Resolving providers with their signals would execute one query per provider
- Asset lookups by code were executed individually for each trade
- Database query count scaled linearly with result set size, causing performance degradation at scale

Traditional approaches like eager-loading via JOIN queries are inefficient in GraphQL because clients request unpredictable field combinations. Server-side batching solutions needed to:
1. Work transparently with any field resolver
2. Batch queries only for fields actually requested by the client
3. Maintain per-request isolation (DataLoaders must be created per GraphQL request)
4. Support complex relationships (e.g., grouped data loaders for one-to-many relations)

## Decision

Implement DataLoader-based batching as the standard N+1 prevention strategy for GraphQL resolvers:

1. **Per-Request DataLoaders:** Create fresh DataLoader instances for every GraphQL request via the context factory. This ensures:
   - No cross-request data leakage
   - Correct batch semantics (each request batches independently)
   - Simple resource cleanup (loaders live only for request duration)

2. **Standard Factory Function:** Use `createDataLoader()` and `createGroupedDataLoader()` utilities to standardize DataLoader setup:
   ```typescript
   const loaders = {
     providerById: createDataLoader(
       (ids) => providersService.findByIds(ids),
       (provider) => provider.id,
     ),
     signalsByProviderId: createGroupedDataLoader(
       (providerIds) => signalsService.findByProviderIds(providerIds),
       (signal) => signal.providerId,
     ),
   };
   ```

3. **Context Injection:** Loaders are attached to the GraphQL context so resolvers access them via `context.loaders.[loaderName]`.

## Consequences

### Positive

- **Performance:** Reduces query count from O(n) to O(1) for batched lookups
- **Transparency:** Resolvers don't need to know about batching logic; they simply call a loader
- **Flexibility:** Each field resolver independently decides whether to batch
- **Per-Request Isolation:** Fresh loaders per request prevent data leakage in concurrent workloads

### Negative

- **Complexity:** Teams must understand DataLoader semantics (queuing, flushing, cache key handling)
- **Memory Usage:** Context object size grows with each loader instance (mitigated by per-request lifecycle)
- **Debugging:** N+1 issues are harder to diagnose if DataLoaders aren't properly configured

### Risks

- Developers creating DataLoaders with long-lived instances (singleton scope) instead of per-request
- Cache key mismatches if identity function (e.g., `(p) => p.id`) returns different types
- Circular batching patterns (e.g., Loader A batches calls to Loader B, and vice versa)

### Mitigations

- Enforce DataLoader instantiation in context factory only; add linting rule to catch singleton DataLoaders
- Document cache key functions and test with type-safe utilities
- Review resolver implementations during code review for circular batching

## References

- DataLoader library: https://github.com/graphql/dataloader
- GraphQL N+1 problem: https://stackoverflow.com/questions/97197/what-is-the-n1-selects-problem-in-orm-object-relational-mapping
- Implementation: `src/graphQL-API/dataloader-factory.ts` and `src/graphQL-API/graphql.module.ts`
