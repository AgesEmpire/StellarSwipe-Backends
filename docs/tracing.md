# Distributed Tracing

StellarSwipe uses **OpenTelemetry** (OTel) for distributed tracing. Traces correlate HTTP
requests, background jobs, DB queries, and outbound HTTP calls into a single end-to-end
view — essential for incident investigation across services.

---

## Architecture

```
Inbound HTTP request
        │
        ▼
TracingMiddleware          assigns / propagates x-trace-id header
        │                  echoes it back in the response
        ▼
OTel HttpInstrumentation   auto-instruments every Express route → span
        │
        ├── OTel PgInstrumentation     → child span per DB query
        └── OTel HttpInstrumentation   → child span per outbound HTTP call
                │
                ▼
        OTLP exporter  ──►  collector (Jaeger / Tempo / Honeycomb / Datadog …)
                │
BullMQ job enqueue
        │  WorkerTracingService.injectTraceId() embeds traceId in job.data
        ▼
Job processor
        │  WorkerTracingService.start() restores the trace ID
        │  WorkerTracingService.finish() / .error() close the span
        ▼
        same trace in the collector
```

Key source files:

| File | Role |
|------|------|
| `src/monitoring/tracing/jaeger.config.ts` | OTel SDK bootstrap (`initTracing()`) |
| `src/tracing/tracing.service.ts` | `TracingService` + `TracingMiddleware` |
| `src/tracing/worker-tracing.service.ts` | BullMQ job span helpers |
| `src/tracing/tracing.module.ts` | NestJS module (registered globally in `AppModule`) |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRACING_ENABLED` | `false` | Set to `true` to activate tracing |
| `TRACING_SERVICE_NAME` | `stellarswipe-backend` | Service name tag on every span |
| `TRACING_SAMPLE_RATE` | `1.0` | Fraction of requests sampled (0.0 – 1.0) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP/HTTP collector URL |
| `JAEGER_OTLP_ENDPOINT` | _(same as above)_ | Legacy alias — prefer `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `OTEL_TRACES_SAMPLER_ARG` | _(mirrors `TRACING_SAMPLE_RATE`)_ | OTel-native sampler arg; takes precedence if set |

> Tracing is **disabled by default** and is a no-op when `TRACING_ENABLED !== 'true'` or
> when the optional `@opentelemetry/*` packages are not installed.

---

## Enabling tracing locally

### 1. Start a local collector (Jaeger all-in-one)

```bash
docker run --rm -d \
  -p 16686:16686 \   # Jaeger UI
  -p 4318:4318 \     # OTLP/HTTP receiver
  --name jaeger \
  jaegertracing/all-in-one:latest
```

### 2. Install the optional OTel packages

```bash
npm install \
  @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-express \
  @opentelemetry/instrumentation-pg
```

### 3. Set env vars

Add to your `.env` (copy from `.env.example`):

```bash
TRACING_ENABLED=true
TRACING_SERVICE_NAME=stellarswipe-backend
TRACING_SAMPLE_RATE=1.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

### 4. Start the app

```bash
npm run start:dev
```

### 5. View traces

Open **http://localhost:16686**, select service `stellarswipe-backend`, and search for traces.

---

## Enabling tracing in staging

### Docker Compose (add to `docker-compose.yml`)

```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "4318:4318"

  app:
    environment:
      TRACING_ENABLED: "true"
      TRACING_SERVICE_NAME: "stellarswipe-backend"
      TRACING_SAMPLE_RATE: "0.1"          # 10% in staging
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://jaeger:4318/v1/traces"
```

### Kubernetes (add to deployment env)

```yaml
env:
  - name: TRACING_ENABLED
    value: "true"
  - name: TRACING_SERVICE_NAME
    value: "stellarswipe-backend"
  - name: TRACING_SAMPLE_RATE
    value: "0.05"                          # 5% in staging
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://otel-collector.observability:4318/v1/traces"
```

### Recommended sample rates

| Environment | `TRACING_SAMPLE_RATE` | Rationale |
|-------------|----------------------|-----------|
| local dev | `1.0` | Capture everything |
| staging | `0.05` – `0.1` | Enough signal, low overhead |
| production | `0.01` – `0.05` | Minimal overhead; adjust during incidents |

The sample rate can be changed **at runtime** without a restart via `TracingService.setSamplingRate()`.

---

## Span coverage

| Layer | How it's traced |
|-------|----------------|
| HTTP requests | `OTel HttpInstrumentation` (auto) + `TracingMiddleware` (x-trace-id header) |
| Express routes | `OTel ExpressInstrumentation` (auto) |
| PostgreSQL queries | `OTel PgInstrumentation` (auto) |
| Outbound HTTP calls | `OTel HttpInstrumentation` (auto) |
| BullMQ jobs | `WorkerTracingService.start()` / `.finish()` / `.error()` (manual) |

---

## Propagating trace IDs in application code

### Outbound HTTP calls

```typescript
@Injectable()
export class MyService {
  constructor(private readonly tracingService: TracingService) {}

  async callDownstream(req: Request) {
    const traceId = this.tracingService.fromRequest(req) ?? randomUUID();
    const correlationId = req.headers['x-correlation-id'] as string;

    await fetch('https://other-service/api', {
      headers: this.tracingService.outboundHeaders(traceId, correlationId),
    });
  }
}
```

### BullMQ job enqueue

```typescript
// Enqueue — embed the current trace ID
const payload = this.workerTracingService.injectTraceId(
  { entityId: 'abc-123' },
  this.tracingService.fromRequest(req) ?? randomUUID(),
);
await this.queue.add('process-trade', payload);

// Process — restore and close the span
@Process('process-trade')
async handle(job: Job) {
  const traceId = this.workerTracingService.start(job);
  try {
    // ... work ...
    this.workerTracingService.finish(traceId, job);
  } catch (err) {
    this.workerTracingService.error(traceId, job, err as Error);
    throw err;
  }
}
```

---

## Sending traces to a managed backend

Replace `OTEL_EXPORTER_OTLP_ENDPOINT` with your vendor's OTLP endpoint:

| Vendor | Endpoint |
|--------|----------|
| Honeycomb | `https://api.honeycomb.io/v1/traces` (add `x-honeycomb-team` header via OTel env) |
| Datadog | `http://datadog-agent:4318/v1/traces` |
| Grafana Tempo | `http://tempo:4318/v1/traces` |
| AWS X-Ray (via ADOT) | `http://aws-otel-collector:4318/v1/traces` |
