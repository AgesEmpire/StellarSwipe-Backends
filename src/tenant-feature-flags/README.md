# Tenant Feature Flags

Runtime feature-flag layer supporting per-tenant toggles, percentage-based rollouts,
and environment-scoped overrides without a redeploy.

## Usage

```ts
constructor(private readonly flags: TenantFeatureFlagsService) {}

if (this.flags.isEnabled('new-checkout', tenantId)) {
  // ...
}
```

## Configuration

Flags are defined via the `FEATURE_FLAGS_JSON` env var (JSON array of
`FeatureFlagDefinition`), and reloaded at runtime via `POST /feature-flags/tenant/refresh`
or `service.refresh()` — no redeploy required. `loadDefinitions()` is the single seam to
swap in a database or remote-config-backed store later.

```json
[
  {
    "key": "new-checkout",
    "defaultEnabled": false,
    "rolloutPercentage": 25,
    "overrides": [
      { "env": "staging", "enabled": true },
      { "tenantId": "acme-corp", "enabled": true }
    ]
  }
]
```

Evaluation order: exact override (env + tenant) > rollout bucket > default.
Rollout bucketing is deterministic per `key:tenantId` (sha256-based), so a tenant's
bucket never flips between requests.

## Observability

- `GET /feature-flags/tenant` — list all loaded definitions.
- `GET /feature-flags/tenant/:key/evaluate?tenantId=...` — see the resolved decision and `reason`.
- Every load/parse-failure/unknown-flag lookup is logged via Nest's `Logger`.

## Safety

- Unknown flags default to disabled (fail closed).
- Malformed `FEATURE_FLAGS_JSON` is caught and logged; service falls back to zero flags
  rather than crashing startup.
- Endpoints are behind the existing JWT `AuthGuard`.
