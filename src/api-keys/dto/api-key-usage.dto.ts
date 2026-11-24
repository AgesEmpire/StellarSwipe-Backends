import { ApiKeyScope } from '../enums/api-key-scope.enum';
import { ApiKey } from '../entities/api-key.entity';

export class ApiKeyUsageDto {
  id!: string;
  name!: string;
  /** Scopes granted to this API key */
  scopes!: ApiKeyScope[];
  lastUsed?: Date;
  expiresAt?: Date;
  rateLimit!: number;
  createdAt!: Date;
  requestCount?: number;
  errorCount?: number;
}

/** Key metadata for list/detail reads. Never includes keyHash or previousKeyHash. */
export class ApiKeyMetadataDto {
  id!: string;
  userId!: string;
  tenantId?: string;
  name!: string;
  scopes!: ApiKeyScope[];
  lastUsed?: Date;
  expiresAt?: Date;
  revokedAt?: Date | null;
  rateLimit!: number;
  isActive!: boolean;
  createdAt!: Date;
}

/**
 * Allowlist projection for read endpoints. Built from named fields only, so
 * hashes on the entity cannot leak through a read.
 */
export function toApiKeyMetadata(key: ApiKey): ApiKeyMetadataDto {
  return {
    id: key.id,
    userId: key.userId,
    tenantId: key.tenantId,
    name: key.name,
    scopes: key.scopes,
    lastUsed: key.lastUsed,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    rateLimit: key.rateLimit,
    isActive: key.isActive,
    createdAt: key.createdAt,
  };
}

export class ApiKeyResponseDto {
  id!: string;
  name!: string;
  /** The raw API key — only returned once at creation/rotation time */
  key!: string;
  /** Scopes granted to this API key */
  scopes!: ApiKeyScope[];
  expiresAt?: Date;
  rateLimit!: number;
  createdAt!: Date;
}

export type ApiKeyScopeDenialReason = 'email_not_verified' | 'tenant_policy_denied';

export class ApiKeyScopeDecisionDto {
  scope!: ApiKeyScope;
  allowed!: boolean;
  /** Set only when allowed is false */
  reason?: ApiKeyScopeDenialReason;
}
