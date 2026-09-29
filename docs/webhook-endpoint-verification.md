# Webhook Endpoint Verification

A webhook destination must prove ownership before it receives deliveries.

## Flow

1. `POST /webhooks` creates the webhook with `active: false` and
   `pendingUrl` set to the requested URL.
2. StellarSwipe sends a challenge to the pending URL:

   ```json
   {
     "event": "webhook.verification",
     "webhookId": "<uuid>",
     "token": "<64 hex chars>",
     "expiresAt": "<ISO timestamp>"
   }
   ```

   The request carries the usual `X-StellarSwipe-Signature` header, signed
   with the webhook secret.
3. The owner submits the token with `POST /webhooks/:id/verify`
   (`{ "token": "..." }`). On success `pendingUrl` becomes `url`, the webhook
   is activated and `urlVerifiedAt` is set.

Changing the URL with `PATCH /webhooks/:id` starts the same flow for the new
URL. Deliveries keep going to the current verified URL until the new one is
verified. An unverified webhook cannot be activated.

## Tokens

- **Scoped**: only the stored SHA-256 of `webhookId:url:token` is kept, so a
  token is valid only for the webhook and URL it was issued for. Issuing a new
  token (URL change or resend) invalidates the previous one.
- **Expiring**: tokens expire after 24 hours
  (`WEBHOOK_VERIFICATION_TOKEN_TTL_MS`).
- **Single-use**: the token is consumed atomically on verification, so
  replaying it fails.

`POST /webhooks/:id/verify/resend` issues a fresh token for the pending URL.

Webhooks that existed before this change are treated as verified by the
`AddWebhookEndpointVerification20260928100000` migration.
