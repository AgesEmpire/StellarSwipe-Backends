# Test API

> Test

**Version:** 1.0

## Servers

- **http://localhost:3000**: `http://localhost:3000`

## Authentication

All endpoints require a Bearer JWT token:

```
Authorization: Bearer <token>
```

## Signals

### List signals
`GET /signals`

**Responses:**

| Status | Description |
|--------|-------------|
| `200` | OK |
