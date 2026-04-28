import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export enum ResetStrategy {
  /** Truncate all sandbox tables and re-seed from scratch */
  FULL = 'full',
  /** Restore from a specific snapshot */
  FROM_SNAPSHOT = 'from_snapshot',
  /** Only re-seed dynamic data (users, tracks, tips) but keep config */
  PARTIAL = 'partial',
}

export class ResetSandboxDto {
  @IsEnum(ResetStrategy)
  strategy: ResetStrategy;

  /** Required when strategy = FROM_SNAPSHOT */
  @IsOptional()
  @IsUUID()
  snapshotId?: string;

  /** Take a pre-reset snapshot before clearing data */
  @IsOptional()
  @IsBoolean()
  capturePreResetSnapshot?: boolean;

  /** Label for the pre-reset snapshot */
  @IsOptional()
  @IsString()
  snapshotLabel?: string;

  /** Re-provision a fresh Stellar testnet keypair after reset */
  @IsOptional()
  @IsBoolean()
  rotateStellarKeypair?: boolean;

  /** Custom seed scenario to run after reset */
  @IsOptional()
  @IsString()
  seedScenario?: string;
}
