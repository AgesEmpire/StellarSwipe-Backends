# Getting Started with StellarSwipe API

## Prerequisites

- A StellarSwipe account
- A Stellar wallet (Freighter, Albedo, or any SEP-7 compatible wallet)

## Step 1 — Authenticate

```bash
curl -X POST http://localhost:3000/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "<your_stellar_address>", "signature": "<signed_challenge>"}'
```

**Response:**
```json
{
  "accessToken": "<jwt_token>",
  "expiresIn": 86400
}
```

## Step 2 — Browse Signals

```bash
curl http://localhost:3000/api/v2/signals?status=ACTIVE&limit=10 \
  -H "Authorization: Bearer <jwt_token>"
```

## Step 3 — Execute a Trade

```bash
curl -X POST http://localhost:3000/api/v2/trades/execute \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<your_user_id>",
    "signalId": "<signal_id>",
    "amount": 100
  }'
```

## Step 4 — Monitor Your Portfolio

```bash
curl "http://localhost:3000/api/v2/portfolio/performance?userId=<your_user_id>" \
  -H "Authorization: Bearer <jwt_token>"
```

## SDKs

- **TypeScript/JavaScript:** `npm install @stellarswipe/sdk`

## Support

- Docs: https://docs.stellarswipe.com
- Email: support@stellarswipe.com
