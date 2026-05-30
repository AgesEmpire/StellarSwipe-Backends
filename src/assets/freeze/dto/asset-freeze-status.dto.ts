import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FreezeReason, FreezeStatus } from '../entities/asset-freeze.entity';

export class AssetFreezeStatusDto {
  @ApiProperty({ description: 'Freeze record UUID' })
  id: string;

  @ApiProperty({ description: 'Asset UUID' })
  assetId: string;

  @ApiProperty({ enum: FreezeStatus, description: 'Current freeze status' })
  status: FreezeStatus;

  @ApiProperty({ enum: FreezeReason, description: 'Reason for the freeze' })
  reason: FreezeReason;

  @ApiPropertyOptional({ description: 'Description of the freeze action' })
  description: string | null;

  @ApiProperty({ description: 'Admin user who initiated the action' })
  initiatedBy: string;

  @ApiPropertyOptional({ description: 'Timestamp when the asset was frozen' })
  frozenAt: Date | null;

  @ApiPropertyOptional({ description: 'Timestamp when the freeze was lifted' })
  unfrozenAt: Date | null;

  @ApiProperty({ description: 'Record creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Record last updated timestamp' })
  updatedAt: Date;
}

export class AssetFreezeCheckDto {
  @ApiProperty({ description: 'Asset UUID' })
  assetId: string;

  @ApiProperty({ description: 'Whether the asset is currently frozen' })
  isFrozen: boolean;

  @ApiPropertyOptional({ type: AssetFreezeStatusDto, description: 'Active freeze record, if any' })
  activeFreeze: AssetFreezeStatusDto | null;
}
