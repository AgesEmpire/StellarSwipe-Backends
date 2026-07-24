# Structured Logging

The backend writes one JSON object per log line through `LoggerService`. Console
and production rotating-file transports use the same JSON format, so logs can be
ingested without environment-specific parsing.

Each request receives an `x-correlation-id` value. A caller-provided value is
preserved; otherwise the middleware generates a UUID. The value is echoed in the
response header and added to logs through `AsyncLocalStorage`. Queue producers
should include the value returned by `BullCorrelationService.captureCorrelationId()`
in job data so worker logs can be linked to the originating request.

Example:

```json
{"timestamp":"2026-07-24T12:00:00.000Z","level":"info","message":"Request completed","context":"LoggingInterceptor","correlationId":"550e8400-e29b-41d4-a716-446655440000","method":"GET","url":"/api/v1/health","statusCode":200,"duration":"12ms"}
```

Sensitive fields are redacted centrally before metadata is passed to Winston.
Default rules cover credentials, tokens, API keys, authorization headers, and
common PII fields. Additional field-name fragments can be configured with
`REDACT_FULL_FIELDS` and `REDACT_PARTIAL_FIELDS` as comma-separated values.

Logger configuration is supplied through the `app.logger.*` settings:

- `app.logger.level` controls the minimum level.
- `app.logger.directory` controls the production log directory.
- `app.logger.maxFiles` controls rotating-file retention.
- `app.logger.maxSize` controls rotating-file size limits.