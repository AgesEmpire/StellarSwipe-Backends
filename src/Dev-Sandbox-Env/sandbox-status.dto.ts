import { SandboxStatus, SandboxTier } from '../entities/sandbox-environment.entity';

export class SandboxStatusDto {
  id: string;
  name: string;
  ownerId: string;
  status: SandboxStatus;
  tier: SandboxTier;
  description: string | null;
  schemaPrefix: string;
  stellarPublicKey: string | null;
  activeSnapshotId: string | null;
  featureFlags: Record<string, boolean>;
  mockConfig: Record<string, unknown>;
  resetCount: number;
  lastResetAt: Date | null;
  expiresAt: Date | null;
  isExpired: boolean;
  createdAt: Date;
  updatedAt: Date;

  /** Runtime health checks */
  health: {
    database: 'ok' | 'degraded' | 'unavailable';
    stellar: 'ok' | 'degraded' | 'unavailable';
    mockServices: 'ok' | 'degraded' | 'unavailable';
  };

  snapshotCount: number;
  metadata: Record<string, unknown>;
}

export class SandboxListItemDto {
  id: string;
  name: string;
  ownerId: string;
  status: SandboxStatus;
  tier: SandboxTier;
  resetCount: number;
  expiresAt: Date | null;
  createdAt: Date;
}
