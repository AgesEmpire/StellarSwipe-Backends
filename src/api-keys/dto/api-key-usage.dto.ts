import { ApiKeyScope } from '../enums/api-key-scope.enum';

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
