# Hourly portfolio P&L snapshots

`PnlSnapshotJob` runs at the top of every UTC hour. It finds users with an
active `PENDING` or `EXECUTING` trade, calculates their realized and unrealized
P&L using the same calculator used by the portfolio API, and inserts one row
per asset into `pnl_history`.

The job processes users in batches. Set `PORTFOLIO_PNL_SNAPSHOT_BATCH_SIZE`
through the configuration layer when the deployment needs a different batch
size; the default is 100 users. The job never creates a row for a user with no
open position, and it catches an individual user's provider or calculation
failure so one bad account does not prevent the remaining batch from running.

Rows older than 90 days are deleted after each successful scan. The timestamp
column is timezone-aware so hourly chart points are not collapsed into one
date. The migration must be applied before deploying the hourly worker.

Administrators can inspect the most recent run at
`GET /admin/portfolio/snapshot-status`. The endpoint reports whether a run is
active, the last successful run, users processed, rows written, rows deleted,
and the last run error. It is protected by the existing admin role guard.

The endpoint is intentionally status-only. Chart consumers continue using the
portfolio chart endpoint, whose history query reads the durable `pnl_history`
rows. Runtime status is process-local telemetry and should not be treated as
a replacement for database history.
