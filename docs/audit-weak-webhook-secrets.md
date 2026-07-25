# Scheduled Audit for Weak Webhook Subscriber Secrets

## Overview
Webhook signature verification and secret rotation rely on subscriber-provided or generated signing secrets, but there is no automated check ensuring those secrets meet a minimum entropy/length bar. This implementation adds a nightly scheduled job that audits all registered webhook secrets, flags weak ones without exposing raw values, and notifies the owning users to rotate their secrets.

## Issues Resolved
- ✅ **#798** - Implement a scheduled audit flagging weak webhook subscriber secrets

## 🚀 Features Implemented

### 1. Secret Strength Utility
**Files Added:**
- `src/webhooks/utils/secret-entropy.util.ts`

**Purpose:**
- Defines `MIN_SECRET_LENGTH` (32) and `MIN_ENTROPY_BITS_PER_CHAR` (3.5)
- `evaluateSecretStrength(secret)` computes Shannon entropy per character and returns a structured result indicating whether the secret is strong and why
- `hashSecret(secret)` produces a masked display string (`****abcd…`) so raw secrets never appear in logs or notifications

### 2. Background Audit Job
**Files Added:**
- `src/webhooks/jobs/audit-webhook-secrets.job.ts`

**Files Modified:**
- `src/webhooks/webhooks.module.ts` — Imports and provides `AuditWebhookSecretsJob`

**Job Behavior:**
- **Schedule**: Runs daily at midnight UTC via `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)`
- **Scope**: Queries all registered `Webhook` entities
- **Validation Logic**:
  1. For each webhook, `evaluateSecretStrength` checks length and entropy
  2. Strong secrets are logged at debug level with length and entropy stats
  3. Weak secrets are logged at warn level with the masked secret hash and reason
  4. A summary line reports strong/weak/total counts
  5. If any weak secrets are found, `notifyOwners` sends an in-app notification to the webhook owner

**Example Log Output:**
```
[AuditWebhookSecretsJob] Starting webhook secret strength audit…
[AuditWebhookSecretsJob] Webhook wh-weak (user=user-2) has a weak secret: Secret is too short (5 chars, minimum 32). Masked=****736f…
[AuditWebhookSecretsJob] Secret audit complete — strong: 0, weak: 1, total: 1
[AuditWebhookSecretsJob] Failed to send rotation notification for webhook wh-weak: User not found
```

### 3. Owner Notification via Existing Notification Channels
- Uses the existing `NotificationService` from `src/notifications/notification.service.ts`
- Sends an `in_app` notification with type `SYSTEM` to the webhook owner
- Notification title: **Webhook Secret Rotation Required**
- Message includes the webhook ID, masked secret, and the required minimums
- Failures to send are caught and logged without crashing the audit run

### 4. Unit Tests
**Files Added:**
- `src/webhooks/jobs/audit-webhook-secrets.job.spec.ts`

**Test Coverage:**
- ✅ Strong secret (64-char hex from `crypto.randomBytes(32).toString('hex')`) — passes audit, no notification
- ✅ Weak secret ("short") — triggers warning, sends notification
- ✅ Low-entropy secret (32 identical chars) — length is sufficient but entropy is too low, triggers warning and notification
- ✅ Empty webhook set — logs "No webhooks found" and returns
- ✅ Strong secret does not trigger notification channel

## 🛡️ Security Considerations
- **No raw secret exposure**: The raw secret is never logged or included in notifications; only a masked hash is shown
- **Timing-safe comparison**: The existing `SignatureGeneratorService` already uses `crypto.timingSafeEqual` for signature verification
- **Entropy-based auditing**: Shannon entropy captures both length and distribution quality
- **In-app notifications**: Users are warned through the existing notification system, avoiding external email/webhook dependencies for security alerts

## 📦 Files Changed
```
src/webhooks/jobs/audit-webhook-secrets.job.spec.ts  | NEW
src/webhooks/jobs/audit-webhook-secrets.job.ts        | NEW
src/webhooks/utils/secret-entropy.util.ts            | NEW
src/webhooks/webhooks.module.ts                      | MODIFIED
docs/audit-weak-webhook-secrets.md                   | NEW
```

## ✅ Verification Steps
1. Run `npm run migration:run` (no new migration required — changes are application-level)
2. Start the application: `npm run start:dev`
3. Verify the job registers and runs at next midnight or trigger it manually if an endpoint is exposed
4. Create a webhook with a deliberately weak secret (e.g., `"short"`)
5. Observe the audit log for the masked weak-secret warning
6. Verify the webhook owner receives an in-app `SYSTEM` notification prompting rotation

## 🔗 Related
- closes #798
