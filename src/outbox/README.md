# Transactional Outbox

1. Inside a business transaction call `outboxService.enqueue(manager, {...})` – the event row commits atomically with the data.
2. `OutboxService.publishPending` runs every 5s, locks a batch with `FOR UPDATE SKIP LOCKED`, and publishes via the `OUTBOX_BROKER` provider (falls back to `EventEmitter2`).
3. Failures back off exponentially (max 15 min); after `OUTBOX_MAX_ATTEMPTS` (default 10) events become `DEAD` and an error is logged.
4. Delivery is at-least-once: consumers must dedupe on the event `id`.

## Monitoring & recovery
- `GET /admin/outbox/stats` – counts per status and oldest pending age (alert when it grows).
- `POST /admin/outbox/replay` `{ "ids": [...] }` – requeue specific events, or all `DEAD` events when `ids` is omitted.
