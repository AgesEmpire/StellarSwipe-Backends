# Retention Policy & Automated Cleanup

## Why

Audit logs, integration (outbox) events, and delivery logs for webhooks and
notifications all grow unbounded by default. Left unmanaged, this increases
storage cost and makes it hard to reason about what "current" retention
actually is. `RetentionService` (`src/common/retention/retention.service.ts`)
gives every one of these record types an explicit, configurable retention
window and a nightly automated cleanup sweep.

## Configuration defaults

| Record type                    | Config env var                        | Default   |
|---------------------------------|----------------------------------------|-----------|
| Audit trail (`AuditLog`)         | `RETENTION_AUDIT_LOG_DAYS`             | 730 days  |
| Integration events (`OutboxEvent`, published only) | `RETENTION_INTEGRATION_EVENT_DAYS` | 30 days   |
| Webhook delivery attempts        | `RETENTION_WEBHOOK_DELIVERY_DAYS`      | 90 days   |
| Notification delivery logs       | `RETENTION_NOTIFICATION_LOG_DAYS`      | 90 days   |

Set any of these env vars to override the default for an environment. Invalid
values (non-numeric or `<= 0`) are ignored and the default is used instead —
see `resolveRetentionDays` in `src/common/retention/retention.config.ts`.

## How cleanup runs

- `RetentionService.enforceAllRetentionPolicies()` runs nightly at 3 AM via
  `@Cron(CronExpression.EVERY_DAY_AT_3AM)`, sweeping every registered policy.
- Each policy is a single `DELETE ... WHERE <dateProperty> < cutoff` (plus an
  optional extra predicate), executed independently — a failure in one policy
  is logged and does not block the others (`runAll` never throws).
- **Integration events are only pruned once published.** Pending or failed
  outbox events are kept regardless of age so they can still be retried /
  investigated; only `status = 'published'` events older than the window are
  removed.
- The audit trail keeps its own dedicated cleanup in `AuditService`
  (`enforceRetentionPolicy`, still at 2 AM) because it needs to bypass a
  `BeforeRemove` hook on `AuditLog` that the generic policies don't need to
  know about — but it now reads its window from the same
  `resolveRetentionDays('auditLogDays')` helper, so `RETENTION_AUDIT_LOG_DAYS`
  controls it too.

## Adding a new policy

```ts
retentionService.registerPolicy({
  name: 'my-new-log-type',
  entity: MyLogEntity,
  dateProperty: 'createdAt', // entity property, not raw column name
  retentionDays: resolveRetentionDays('myNewLogTypeDays'),
});
```

Register it from a module's `onModuleInit` (see `RetentionModule` for the
pattern) so it's picked up by the next nightly sweep automatically.

## Operational notes

- Retention sweeps run as plain `DELETE`s, not batched — acceptable at
  nightly cadence for these tables' expected growth rates. If a table grows
  large enough that a single delete becomes slow, batch by adding a `LIMIT`
  loop inside `RetentionService.runPolicy` rather than changing the policy
  interface.
- Widening a retention window (raising the env var) takes effect on the next
  scheduled run; there is no need to restart for a manual sweep — call
  `RetentionService.runAll()` (e.g. from the CLI) to apply immediately.
- Narrowing a window will delete the newly-out-of-window backlog on the very
  next run. If a large one-time deletion is expected, watch table locks
  during the first sweep after a config change.
