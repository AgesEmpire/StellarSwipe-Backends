// ─── create-sandbox.dto.ts ───────────────────────────────────────────────────
import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsBoolean,
  IsObject,
  MaxLength,
  MinLength,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { SandboxTier } from '../entities/sandbox-environment.entity';

export class CreateSandboxDto {
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'name must be lowercase alphanumeric with hyphens only',
  })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsEnum(SandboxTier)
  tier?: SandboxTier;

  /** Seed a specific snapshot on creation */
  @IsOptional()
  @IsString()
  seedSnapshotId?: string;

  /** Whether to provision a Stellar testnet keypair */
  @IsOptional()
  @IsBoolean()
  withStellarAccount?: boolean;

  /** Feature flags to enable at creation */
  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, boolean>;

  /** TTL in seconds (max 7 days) */
  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(604_800)
  ttlSeconds?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
