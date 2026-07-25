# Structured Logging

## Overview

All log output is **JSON-formatted** (Winston) in production and pretty-printed in development. Every log line carries a `correlationId` that links HTTP requests to background jobs, making it trivial to filter a full request trace in any log aggregation system (Datadog, CloudWatch, Loki, etc.).

---

## Log Format

### Production (JSON)

```json
{
  "level": "info",
  "message": "Request completed",
  "timestamp": "2025-01-19T12:00:00.000Z",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "context": "LoggingInterceptor",
  "method": "POST",
  "url": "/api/v2/trades",
  "statusCode": 201,
  "duration": "43ms",
  "userId": "usr-abc123"
}
```

### Development (colorized text)

```
2025-01-19 12:00:00 info [LoggingInterceptor] Request completed
{
  "correlationId": "550e8400-...",
  "method": "POST",
  "url": "/api/v2/trades",
  "statusCode": 201,
  "duration": "43ms"
}
```

### Error log

```json
{
  "level": "error",
  "message": "Request failed",
  "timestamp": "2025-01-19T12:00:01.000Z",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "context": "LoggingInterceptor",
  "error": {
    "name": "Error",
    "message": "Deadlock detected",
    "stack": "Error: Deadlock detected\n    at ..."
  },
  "method": "POST",
  "url": "/api/v2/trades",
  "duration": "120ms"
}
```

---

## Correlation IDs

### How it works

```
Inbound HTTP request
        │
        ▼
CorrelationIdMiddleware          reads x-correlation-id header (or generates UUID v4)
        │                        stores it in AsyncLocalStorage via CorrelationIdStore
        │                        echoes it back in x-correlation-id response header
        ▼
LoggingInterceptor               reads correlationId from CorrelationIdStore
        │                        stamps every log line automatically
        ▼
LoggerService.baseMeta()         called on every log write — no manual threading needed
        │
        ▼
BullMQ job enqueue               BullCorrelationService.captureCorrelationId()
        │                        copies the current correlationId into job.data
        ▼
Job processor                    BullCorrelationService.getJobCorrelationId(job.data)
                                 restores the ID so worker logs share the same trace
```

### Passing a correlation ID from a client

Include the header on any request to preserve the ID across service hops:

```
x-correlation-id: 550e8400-e29b-41d4-a716-446655440000
```

If the header is absent a new UUID v4 is generated automatically.

### Reading the correlation ID in application code

```typescript
// Anywhere inside an HTTP request's async call chain:
@Injectable()
export class MyService {
  constructor(private readonly correlationIdStore: CorrelationIdStore) {}

  doWork() {
    const id = this.correlationIdStore.getCorrelationId();
    // id is automatically present — no need to pass it as a parameter
  }
}
```

### Background jobs (BullMQ)

```typescript
// Enqueue — capture the current request's correlation ID
const payload = {
  entityId: 'abc-123',
  correlationId: this.bullCorrelation.captureCorrelationId(),
};
await this.queue.add('process-trade', payload);

// Process — restore it for worker logs
@Process('process-trade')
async handle(job: Job<typeof payload>) {
  const correlationId = this.bullCorrelation.getJobCorrelationId(job.data);
  this.logger.info('Processing trade', { correlationId, entityId: job.data.entityId });
}
```

---

## Sensitive Field Redaction

Redaction is applied automatically by `LoggerService` before any log is written. No manual scrubbing is needed in application code.

### Full redaction → `[REDACTED]`

Fields whose **key** contains any of these substrings (case-insensitive):

| Substring | Example keys |
|-----------|-------------|
| `password` | `password`, `UserPassword` |
| `token` | `token`, `accessToken`, `refreshToken`, `tokens` |
| `apikey` | `apiKey`, `API_KEY` |
| `secretkey` | `secretKey` |
| `privatekey` | `privateKey` |
| `authorization` | `authorization` |
| `secret` | `secret`, `clientSecret` |
| `otp` | `otp` |
| `pin` | `pin` |
| `cvv` | `cvv` |
| `ssn` | `ssn` |

### Partial masking → `****<last4>`

Fields whose **key** contains any of these substrings:

| Substring | Example | Masked output |
|-----------|---------|---------------|
| `email` | `alice@example.com` | `****.com` |
| `walletaddress` | `GABCDE...7890` | `****7890` |
| `address` | `123 Main St` | `****n St` |
| `phone` | `+1-800-555-0199` | `****0199` |
| `cardnumber` | `4111111111111111` | `****1111` |
| `accountnumber` | `00123456789` | `****6789` |
| `iban` | `GB29NWBK...` | `****NWBK` |

Values of 4 characters or fewer are fully redacted.

### Extending the field lists at runtime

Add extra field-name substrings via environment variables — no code change required:

```bash
# .env
REDACT_FULL_FIELDS=taxId,nationalId,driverLicense
REDACT_PARTIAL_FIELDS=passportNumber,employeeId
```

---

## Configuration

| Environment variable | Default | Description |
|---------------------|---------|-------------|
| `LOG_LEVEL` | `info` | Winston log level (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | `development` | `production` enables file transports and pure JSON console output |
| `LOG_DIRECTORY` | `./logs` | Directory for rotating log files (production only) |
| `LOG_MAX_FILES` | `14d` | Retention window for rotated files |
| `LOG_MAX_SIZE` | `20m` | Max size per log file before rotation |
| `REDACT_FULL_FIELDS` | _(empty)_ | Comma-separated extra substrings for full redaction |
| `REDACT_PARTIAL_FIELDS` | _(empty)_ | Comma-separated extra substrings for partial masking |

---

## File Transports (production only)

| File pattern | Level | Description |
|-------------|-------|-------------|
| `logs/error-YYYY-MM-DD.log` | `error` | Error-only rotating log |
| `logs/combined-YYYY-MM-DD.log` | all | Full combined rotating log |

---

## Filtering in log aggregation systems

### Filter by correlation ID (Datadog / CloudWatch Insights)

```
# Datadog
@correlationId:"550e8400-e29b-41d4-a716-446655440000"

# CloudWatch Insights
fields @timestamp, level, message, correlationId
| filter correlationId = "550e8400-e29b-41d4-a716-446655440000"
| sort @timestamp asc
```

### Filter errors for a specific user

```
# Datadog
level:error @userId:"usr-abc123"

# CloudWatch Insights
fields @timestamp, message, userId, error.message
| filter level = "error" and userId = "usr-abc123"
```

---

## Key source files

| File | Purpose |
|------|---------|
| `src/common/logger/logger.service.ts` | Winston logger, redaction, `baseMeta()` |
| `src/common/logger/log-redaction.ts` | Recursive field redaction utility |
| `src/common/correlation/correlation-id.store.ts` | AsyncLocalStorage-backed correlation context |
| `src/common/middleware/correlation-id.middleware.ts` | Assigns/propagates correlation ID per request |
| `src/common/interceptors/logging.interceptor.ts` | HTTP request/response structured logging |
| `src/common/bull/bull-correlation.service.ts` | Correlation ID capture/restore for BullMQ jobs |
