# Secret Rotation Runbook

## Overview

This runbook describes the procedure for rotating application secrets (database
passwords, JWT signing keys, API tokens, encryption keys) with zero downtime.

The rotation system uses an **overlap window** during which both old and new
credentials are accepted, ensuring in-flight requests complete successfully.

## Architecture

| Component | Responsibility |
|-----------|---------------|
| `CredentialOverlapService` | Manages the overlap window; validates old + new credentials simultaneously |
| `RotationEventService` | Emits lifecycle events (`started`, `overlap-active`, `overlap-expired`, `completed`, `failed`) |
| `RotationService` | In-memory secret registry with auto-rotation timers |
| `SecretRotationScheduler` | Orchestrates rotation plans across multiple secrets |
| `SecretsLoaderService` | Loads secrets from configured provider (env, Vault, AWS, K8s) |

## Overlap Windows by Credential Type

| Credential | Default Overlap | Reason |
|-----------|----------------|--------|
| `database.password` | 5 minutes | Allow existing DB pool connections to drain |
| `jwt.secret` | 30 minutes | Allow existing signed tokens to validate |
| `encryption.key` | 1 hour | Allow decryption of recently-encrypted data |
| `stellar.secret_key` | 2 minutes | Allow in-flight transactions to complete |

## Rotation Procedure

### 1. Pre-rotation Checks

- Verify the application is healthy (`GET /api/v1/health/healthz`)
- Confirm the secrets provider (Vault, AWS SM, etc.) is reachable
- Notify on-call team via Slack that rotation is starting

### 2. Execute Rotation

**Single secret:**

```bash
# Via admin CLI
npm run admin -- rotate-secret --name database.password

# Via API (admin-authenticated)
POST /api/v1/admin/secrets/rotate
{ "secretName": "database.password" }
```

**Multiple secrets (rotation plan):**

```bash
npm run admin -- rotate-secrets --names database.password,jwt.secret
```

### 3. During Overlap Window

- Both old and new credentials are accepted
- Monitor logs for `Rotation [overlap-active]` messages
- Watch for any `401` or `connection refused` errors in application logs
- Verify new connections are using the new credential

### 4. Post-rotation Verification

- Confirm `Rotation [overlap-expired]` appears in logs
- Verify the old credential is rejected
- Check application health endpoint
- Confirm no elevated error rates in monitoring

## Emergency Bypass

If rotation causes issues during the overlap window:

1. The old credential remains valid — no immediate action needed
2. To abort: restart the application with the old credential in environment
3. The overlap service purges state on restart

## Scheduled Rotation

The `SecretRotationScheduler` runs daily at 2 AM UTC. Secrets with
`autoRotateIntervalMs > 0` are rotated automatically when their interval
has elapsed. Manual-only secrets (`intervalMs: 0`) are never auto-rotated.

## Refreshing Baseline

After a rotation, update the secrets in the external provider:

1. Update the value in Vault / AWS Secrets Manager / K8s Secret
2. Invalidate the `SecretsLoaderService` cache
3. Verify the next application startup loads the new value
