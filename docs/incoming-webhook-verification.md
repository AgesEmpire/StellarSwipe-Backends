# Incoming Webhook Signature Verification, Rotation & Replay Protection

## Overview
Several endpoints accept webhooks *from* third parties (Persona, Onfido,
M-Pesa, Paystack, Stripe, Zapier/Make). Before this change, the shared
verifier used a single static secret per provider, had no protection
against replayed deliveries, and only lightly checked for malformed
payloads. This closes those gaps for the central `WebhookVerifierService`
and extends secret rotation to the KYC providers that verify signatures
themselves.

## Threat model addressed
- **Forged signatures** — unchanged: HMAC + `crypto.timingSafeEqual`.
- **Secret rotation without downtime** — a provider secret can now be a
  comma-separated list; both the new and old value verify until the old one
  is removed.
- **Replayed deliveries** — an attacker (or a misbehaving retry) resending a
  previously-accepted request is rejected.
- **Malformed requests** — empty/missing bodies are rejected with `400`
  before any signature work or business logic runs, so they never reach a
  handler.

## What changed

### `WebhookVerifierService` (`src/integrations/webhooks/webhook-verifier.service.ts`)
Used by the automation (Zapier/Make), M-Pesa, and Paystack inbound webhook
controllers. `validateRequest(...)` now runs, in order:

1. **Malformed payload** → `400 BadRequestException` if no body was
   captured at all (empty buffer/string, or no raw body *and* no parsed
   body).
2. **Signature check with rotation** → `401 UnauthorizedException` if the
   signature doesn't match any secret configured for the provider. The
   provider's config key (e.g. `MPESA_WEBHOOK_SECRET`) may hold a
   comma-separated list: `newSecret,oldSecret`. Every secret is tried in
   order; a match on anything but the first is logged as a warning so
   operators know it's still safe to keep the old secret around, or that
   it's now safe to drop it.
3. **Timestamp tolerance** (for signature formats that carry a timestamp,
   `t=<unix>,v1=<hex>`) → `401 UnauthorizedException` if the timestamp is
   more than `toleranceSeconds` (default 300s) away from now, in *either*
   direction.
4. **Replay dedupe** → `409 ConflictException` if the exact same signature
   has already been accepted within `replayWindowSeconds` (default
   `max(2 * toleranceSeconds, 600)` seconds). This uses the existing
   `DistributedLockService` (`SET key token PX ttl NX` — atomic, works
   across instances) keyed by `sha256(signatureHeader)`, so it only ever
   "spends" the dedupe slot on a request that already proved authenticity.

If the replay store (Redis) is unreachable, the check fails **open** — the
request has already passed signature verification, and durable,
provider-level idempotency (`WebhookIdempotencyService`, used by the
M-Pesa/Paystack/Stripe handlers) remains as a second line of defense
against duplicate side effects. An outage of the replay store degrades
defense-in-depth; it does not take down webhook ingestion.

Every outcome is recorded via `PrometheusService`:
- `webhook_verification_total{provider,result}` — `result` is one of
  `accepted`, `malformed_payload`, `missing_signature`, `invalid_signature`,
  `stale_timestamp`, `replayed`, `replay_check_unavailable`, `misconfigured`.
- `webhook_secret_index_used_total{provider,secret_index}` — nonzero values
  mean a sender is still using a rotated-out secret; alert on this staying
  nonzero for longer than your expected rotation grace period.

### Rotation support for KYC providers
`PersonaProvider` and `OnfidoProvider` verify their own webhook signatures
(they aren't wired through `WebhookVerifierService`). Both now accept a
comma-separated secret/token list (`PERSONA_WEBHOOK_SECRET`,
`ONFIDO_WEBHOOK_TOKEN`) via the same `verifyRotatingHmacSignature` utility,
so rotation works the same way everywhere. Persona's timestamp check was
also tightened to reject timestamps too far in the *future*, not just too
far in the past.

### Bug fix
`src/payments/local-methods/local-payment.module.ts` referenced
`WebhookIdempotencyModule` in its `imports` array without importing it —
the module would not compile. Fixed, and `DistributedLockService` was added
as a provider there and in `AutomationModule` so `WebhookVerifierService`'s
replay check has what it needs in every module that uses it.

## How to rotate a webhook secret
1. Generate a new secret/token (e.g. `openssl rand -hex 32`).
2. Update the relevant env var to `<new>,<old>` (new value first).
3. Deploy. Both values now verify.
4. Update the secret on the provider's dashboard (Persona, Onfido, M-Pesa,
   Paystack, etc.) or in your own Zapier/Make webhook config.
5. Watch `webhook_secret_index_used_total{secret_index="0"}` climb to 100%
   of traffic for that provider — that means the sender has switched over.
6. Remove the old value from the env var and redeploy.

## Configuration
See `.env.example` for `WEBHOOK_SIGNING_KEY`, `MPESA_WEBHOOK_SECRET`,
`PAYSTACK_SECRET_KEY`, `PERSONA_WEBHOOK_SECRET`, `ONFIDO_WEBHOOK_TOKEN`.

`validateRequest` options relevant to tuning a specific integration:
- `toleranceSeconds` — clock-skew tolerance for timestamped formats.
- `replayWindowSeconds` — how long a signature is remembered for dedupe.
- `enableReplayProtection: false` — opt out for a provider that already
  guarantees delivery uniqueness through some other durable mechanism.

## Files changed
```
src/integrations/webhooks/utils/signature-validator.ts       | MODIFIED
src/integrations/webhooks/utils/signature-validator.spec.ts   | NEW
src/integrations/webhooks/webhook-verifier.service.ts         | MODIFIED
src/integrations/webhooks/webhook-verifier.service.spec.ts     | MODIFIED
src/monitoring/metrics/prometheus.service.ts                   | MODIFIED
src/integrations/automation-platforms/automation.module.ts     | MODIFIED
src/integrations/automation-platforms/automation.controller.ts | MODIFIED
src/integrations/automation-platforms/automation.controller.spec.ts | MODIFIED
src/payments/local-methods/local-payment.module.ts              | MODIFIED (bug fix + DI)
src/payments/local-methods/local-payment.controller.ts          | MODIFIED
src/payments/local-methods/local-payment.controller.spec.ts     | MODIFIED
src/kyc/providers/persona.provider.ts                           | MODIFIED
src/kyc/providers/persona.provider.spec.ts                      | NEW
src/kyc/providers/onfido.provider.ts                            | MODIFIED
src/kyc/providers/onfido.provider.spec.ts                       | NEW
.env.example                                                    | MODIFIED
docs/incoming-webhook-verification.md                           | NEW
```

## Verification steps
1. `npm test -- webhook-verifier signature-validator persona.provider onfido.provider automation.controller local-payment.controller`
2. Manually: send a webhook with a valid signature, replay the exact same
   request → second attempt returns `409`.
3. Manually: rotate `MPESA_WEBHOOK_SECRET` to `newSecret,oldSecret`, send a
   request signed with the old secret → still `200`; check
   `webhook_secret_index_used_total` for a nonzero `secret_index`.
4. Manually: `POST` an empty body to any inbound webhook route → `400`
   before the handler runs.

## Out of scope / follow-ups
- Wiring `PersonaProvider`/`OnfidoProvider` through `WebhookVerifierService`
  itself (for shared replay-dedupe + metrics) would require refactoring
  `KycService`/`KycController`; left as a follow-up to avoid destabilizing
  an unrelated, working flow in this change.
- Stripe's webhook is verified via the Stripe SDK
  (`gateway.handleWebhook`), which has its own rotation/tolerance handling;
  not touched here.
- `KycController`'s webhook routes have no rate limiting today (unlike the
  M-Pesa/Paystack/automation routes); worth a follow-up given they're
  unauthenticated by design.
