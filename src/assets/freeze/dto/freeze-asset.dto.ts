import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FreezeReason } from '../entities/asset-freeze.entity';

export class FreezeAssetDto {
  @ApiProperty({ description: 'UUID of the asset to freeze' })
  @IsUUID()
  assetId: string;

  @ApiProperty({
    enum: FreezeReason,
    description: 'Reason category for the freeze action',
    example: FreezeReason.SECURITY,
  })
  @IsEnum(FreezeReason)
  reason: FreezeReason;

  @ApiPropertyOptional({
    description: 'Human-readable description of why the asset is being frozen',
    example: 'Suspicious trading activity detected on this asset',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;
}

export class UnfreezeAssetDto {
  @ApiProperty({ description: 'UUID of the asset to unfreeze' })
  @IsUUID()
  assetId: string;

  @ApiPropertyOptional({
    description: 'Reason for lifting the freeze',
    example: 'Investigation completed — no violation found',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;
}
