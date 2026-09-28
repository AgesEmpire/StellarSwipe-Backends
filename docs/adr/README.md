# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for the StellarSwipe backend. An ADR documents a significant architectural decision, including the context, decision, and consequences.

## What is an ADR?

An ADR is a lightweight decision-making record that:
- Captures the context and reasoning behind architectural decisions
- Is accessible to the team and future contributors
- Serves as documentation of *why* the system is built a certain way
- Remains relevant long after the decision is made

## ADR Format

All ADRs follow the template in [`0000-template.md`](./0000-template.md). Use this structure:

1. **Status** — Proposed | Accepted | Deprecated | Superseded
2. **Context** — What problem are we solving?
3. **Decision** — What approach did we choose?
4. **Consequences** — What are the trade-offs?
5. **References** — Related issues, discussions, or external resources

## Filing and Numbering

- Number ADRs sequentially: `0001.md`, `0002.md`, etc.
- Propose an ADR **before** or **during** implementation of significant architectural changes
- Do not document trivial implementation details; focus on decisions that affect system design, maintainability, or performance across multiple teams

## Architectural Significance

An ADR is required when changes affect:

- **Data layer:** Database schema, ORM patterns, connection pooling strategies
- **API layer:** GraphQL schema design, REST endpoint versioning, error handling strategies
- **External integrations:** Stellar Horizon, Soroban RPC, third-party service abstractions
- **Security:** Authentication, authorization, secrets management, key rotation
- **Performance:** Caching strategies, N+1 prevention, query optimization, rate limiting
- **Observability:** Logging, tracing, metrics collection strategies
- **Async processing:** Job queues, event handlers, message-driven patterns
- **System architecture:** Module structure, service boundaries, dependency injection patterns

## Pull Request Process

When a PR modifies architecturally-significant paths (see CI configuration below):

1. **Include an ADR:** Create a new ADR or reference an existing one in the PR description
2. **If bypassing is necessary:** Add the `adr-exemption` label with justification in the PR description
3. **Review:** ADRs are reviewed as part of code review to ensure clarity and correctness

### Architecturally-Significant Paths

The CI check enforces ADRs for changes to:

```
src/graphQL-API/
src/stellar/
src/auth/
src/common/error-classification/
src/database/
src/cache/
src/common/middleware/
```

Run locally to check:

```bash
# Check which paths require ADRs in this PR
npm run adr:check

# Create a new ADR
npm run adr:create "My Architecture Decision"
```

## Examples

- [ADR 0001: DataLoader-Based N+1 Query Prevention](./0001-graphql-dataloader-batching.md) — Explains why we batch database queries in GraphQL via DataLoaders
- Refer to existing ADRs for style and structure

## Deprecating ADRs

If an ADR is superseded by a new decision:

1. Update the superseded ADR's status to `Superseded by ADR-XXXX`
2. Create a new ADR with status `Accepted`
3. Link both ADRs to each other in the References section

## Questions?

ADRs are discussion artifacts. If clarity is needed during code review, ask in the PR comment thread rather than updating the ADR after merge. Minor clarifications can be updated via subsequent PRs.
