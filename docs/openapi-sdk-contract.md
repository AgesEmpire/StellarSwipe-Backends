# OpenAPI / SDK Contract Checks

This document describes the deterministic generation and drift-detection pipeline for the OpenAPI specification and the TypeScript SDK types. It satisfies the requirements of issue #1037.

## Quick regeneration (when controllers or DTOs change)

```bash
# 1. Export the current OpenAPI document from the NestJS application
npm run export:openapi

# 2. Regenerate the committed SDK types
npm run sdk:generate-types

# 3. Review + commit
git add docs/generated/openapi.json sdk/typescript/src/types/openapi.generated.ts
git commit -m "chore(sdk): regenerate types from updated OpenAPI spec"
```

## What the CI check does

The workflow `.github/workflows/sdk-drift-check.yml`:

1. Builds the application.
2. Runs `npm run export:openapi` (deterministic generation of `docs/generated/openapi.json`).
3. Regenerates TypeScript types with the same `openapi-typescript@6` version used locally.
4. Diffs the regenerated types against the committed `sdk/typescript/src/types/openapi.generated.ts` (headers/comments are stripped so only semantic drift fails the build).
5. Uploads the focused diff as an artifact on failure.

Local equivalent:

```bash
npm run export:openapi
npm run sdk:check-drift          # or ./scripts/check-sdk-drift.sh
# CI mode (stricter messaging):
./scripts/check-sdk-drift.sh --ci
```

## Schema validation fixtures

Representative request/response fixtures live under `test/fixtures/openapi/`:

| Fixture | Purpose |
|---------|---------|
| `simulate-contract.valid.json` | Happy-path request that must pass |
| `simulate-contract.missing-required.json` | Proves detection of missing required fields |
| `simulate-contract.incompatible-type.json` | Proves detection of incompatible field types |
| `simulate-contract-response.valid.json` | Happy-path response |

These are exercised by `test/contracts/openapi-sdk-contract.spec.ts` (part of the `contracts` Jest project).

## Design notes

- Generation is pinned to `openapi-typescript@6` for deterministic output across machines and CI.
- The committed types file carries a stable header that documents the exact regeneration commands; the header is rewritten on every `sdk:generate-types` run so cosmetic differences never trigger false positives.
- Hand-written types remain in `sdk/typescript/src/types/index.ts` for the richer domain model used by the SDK client; the generated file is the pure OpenAPI contract surface.
