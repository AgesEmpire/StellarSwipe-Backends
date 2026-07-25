# Performance Baseline Metrics

Measured against a single-node staging instance (4 vCPU, 8 GB RAM, PostgreSQL 15, Redis 7).

## Critical Endpoint Baselines

| Endpoint | Method | p50 (ms) | p95 (ms) | p99 (ms) | RPS (sustained) |
|---|---|---|---|---|---|
| `POST /api/v1/trades` | Trade execution | 45 | 120 | 210 | 320 |
| `POST /api/v1/auth/register` | User onboarding | 30 | 85 | 150 | 500 |
| `GET /api/v1/signals` | Signal feed | 12 | 35 | 60 | 1200 |

## Benchmark Configuration

Scripts live in `scripts/benchmark/`. Each uses [autocannon](https://github.com/mcollina/autocannon) with a reproducible config:

```bash
# Trade execution (10 connections, 30 s)
node scripts/benchmark/trade-execution.js

# User onboarding (10 connections, 30 s)
node scripts/benchmark/user-onboarding.js

# Signal feed (50 connections, 30 s)
node scripts/benchmark/signal-feed.js
```

### Prerequisites

```bash
npm install -g autocannon   # one-time global install
cp .env.example .env.benchmark
# Set BENCHMARK_BASE_URL, BENCHMARK_TOKEN in .env.benchmark
```

## Running in CI

The `benchmark.yml` workflow runs on PRs that touch performance-critical paths
(`src/trades/**`, `src/auth/**`, `src/signals/**`). Results are uploaded as
artifacts and compared against the baselines above. The job is **non-blocking**
by default; set `BENCHMARK_GATE=true` in the repo environment to make it a
required check on release branches.

## Profiling Guide

1. Start the app with `NODE_ENV=profiling npm run start:dev`.
2. Hit the target endpoint under load (use the benchmark scripts above).
3. The built-in profiler (`src/performance-profiling/`) exposes
   `GET /api/v1/profiler/report` — download the flamegraph JSON.
4. Open the JSON in [speedscope.app](https://www.speedscope.app) to identify
   hot paths.
5. For memory leaks run `node --inspect` and attach Chrome DevTools.

## Updating Baselines

After a confirmed performance improvement, update the table above and commit
the change alongside the PR that caused it. Include the autocannon summary
output as a PR comment.
