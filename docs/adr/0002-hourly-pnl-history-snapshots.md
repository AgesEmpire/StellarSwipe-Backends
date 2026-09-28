# ADR 0002: Persist hourly P&L history snapshots

- Status: Accepted
- Date: 2026-08-18

## Context

Portfolio chart data is backed by `pnl_history`, but the existing scheduled
snapshot path writes a separate portfolio snapshot entity on a nightly
schedule. That loses intraday changes and leaves the chart history empty for
users whose portfolio has not been explicitly refreshed. P&L calculations also
depend on live price data, so the work must be bounded and observable when it
runs across a large user population.

## Decision

Run a UTC cron job at the start of every hour. Select only users with active
open positions, process them in configurable batches, calculate P&L using the
existing calculator and current prices, and bulk insert asset-level rows into
`pnl_history`. Keep the history timestamp timezone-aware and add a composite
`user_id, snapshot_date` index for chart queries. Delete rows older than 90 days
after each run. Isolate an individual user’s provider/calculation error and
expose process-local run status through an admin endpoint.

## Consequences

Hourly history gives portfolio charts meaningful intraday resolution at the
cost of more writes. Batch inserts and active-position selection bound memory
and database pressure. Retention cleanup prevents unbounded growth. Runtime
status is useful for operations but is intentionally not the durable source of
truth; the history table remains authoritative. A deployment must apply the
timestamp migration before enabling the worker.

## References

- Issue #998: Add scheduled PnL snapshot job for portfolio chart data history
- `docs/guides/pnl-snapshot-job.md`
