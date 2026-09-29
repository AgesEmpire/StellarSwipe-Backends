# Security Audit Trail

Usage:
```ts
@UseInterceptors(SecurityAuditInterceptor)
@SecurityAudit({ action: AuditAction.ROLE_CHANGED, targetType: 'user' })
@Patch(':id/role') changeRole() {}
```
or call `SecurityAuditService.record(...)` directly.

- **Fields**: actor, action, target (type/id), outcome, correlation ID (`x-correlation-id` / `x-request-id`), IP, user agent, redacted metadata.
- **Cannot be skipped**: on success the write is awaited; if it fails the request returns 500.
- **Tamper-aware**: records form a SHA-256 (HMAC with `AUDIT_HMAC_KEY`) hash chain; `verifyChain()` reports the first broken record. Entity hooks block ORM updates/deletes.
- **Retention**: 2 years (see `AuditService.RETENTION_DAYS`); archive before purge and re-anchor the chain from the first retained record.
- **Access**: query via `SecurityAuditService.query`; expose only behind admin/compliance roles.
