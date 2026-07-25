# Feature Flag Entrypoint Validation

## Problem

Feature-flag entrypoints varied between environments and sometimes defaulted to
unexpected behaviour (e.g. a flag missing from the DB silently evaluated to
`false`, disabling a critical flow in production).

## Solution

`FeatureFlagsService` implements `OnApplicationBootstrap`. On every startup it:

1. Checks that every flag listed in `REQUIRED_FLAGS` exists in the database.
2. Auto-seeds any missing flag with its documented safe default.
3. Logs a `WARN` listing the seeded flags so operators are alerted immediately.

### Adding a required flag

Edit `REQUIRED_FLAGS` in `src/feature-flags/feature-flags.service.ts`:

```ts
const REQUIRED_FLAGS = [
  { name: 'my-new-feature', description: 'Enable my new feature', enabled: false },
  // ...
];
```

The next deployment will auto-seed the flag if it is absent. Choose `enabled: false`
as the default for any flag that gates new or risky behaviour.

## Environment Overrides

Set `FEATURE_FLAGS_OVERRIDES` in the environment to force a flag value without
touching the database. This takes precedence over the DB value at evaluation time.

```
# .env.staging
FEATURE_FLAGS_OVERRIDES=trade-execution=true,kyc-required=false
```

Format: comma-separated `name=true|false` pairs.

## CI Lint Step

The `ci.yml` workflow runs `node scripts/check-destructive-migrations.js` on
every PR. A similar lint step for feature flags can be added by running:

```bash
node -e "
const svc = require('./src/feature-flags/feature-flags.service');
// Validates REQUIRED_FLAGS array is non-empty and all entries have a name + enabled field
"
```

For now, the startup validator itself acts as the runtime gate — any missing
flag is seeded and logged before the first request is served.

## Operational Runbook

| Situation | Action |
|---|---|
| Flag missing in production | Check startup logs for `Auto-seeded` warning; verify default is correct |
| Need to override a flag without a deploy | Set `FEATURE_FLAGS_OVERRIDES` env var and restart the pod |
| Flag should be removed | Delete via `DELETE /api/v1/feature-flags/:name` and remove from `REQUIRED_FLAGS` |
| Unexpected flag default in staging | Add an entry to `FEATURE_FLAGS_OVERRIDES` in the staging environment config |
