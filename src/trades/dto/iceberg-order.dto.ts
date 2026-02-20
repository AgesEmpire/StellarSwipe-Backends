import { Transform } from 'class-transformer';
import {
  IsUUID,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
  IsDateString,
  ValidateIf,
} from 'class-validator';

// ─── Create DTO ───────────────────────────────────────────────────────────────

export class CreateIcebergOrderDto {
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  /** Optional link to an open position / parent trade */
  @IsUUID()
  @IsOptional()
  positionId?: string;

  // ── Credentials ────────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty()
  sourceSecret!: string;

  // ── Asset pair ─────────────────────────────────────────────────────────────

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  sellingAssetCode!: string;

  @ValidateIf((dto) => dto.sellingAssetCode !== 'XLM')
  @IsString()
  @IsNotEmpty()
  sellingAssetIssuer?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  buyingAssetCode!: string;

  @ValidateIf((dto) => dto.buyingAssetCode !== 'XLM')
  @IsString()
  @IsNotEmpty()
  buyingAssetIssuer?: string;

  // ── Sizes ──────────────────────────────────────────────────────────────────

  /**
   * Total (hidden) order size.
   * Example: 1000
   */
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  totalAmount!: number;

  /**
   * Amount to display in the order book at a time.
   * Must be less than totalAmount.
   * Example: 100
   */
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  displayAmount!: number;

  // ── Price ──────────────────────────────────────────────────────────────────

  /**
   * Limit price for each displayed slice.
   */
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  limitPrice!: number;

  // ── Optional TTL ───────────────────────────────────────────────────────────

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

// ─── Response DTOs ────────────────────────────────────────────────────────────

export class IcebergOrderResponseDto {
  id!: string;
  userId!: string;
  positionId?: string;
  status!: string;
  sellingAssetCode!: string;
  buyingAssetCode!: string;
  limitPrice!: number;
  totalAmount!: number;
  displayAmount!: number;
  filledAmount!: number;
  remainingAmount!: number;
  fillPercentage!: number;
  refillCount!: number;
  activeOfferId?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

// ─── Cancel DTO ──────────────────────────────────────────────────────────────

export class CancelIcebergOrderDto {
  @IsUUID()
  @IsNotEmpty()
  orderId!: string;

  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  sourceSecret!: string;
}
