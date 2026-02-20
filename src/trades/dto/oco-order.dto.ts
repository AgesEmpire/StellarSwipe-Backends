import { Transform, Type } from 'class-transformer';
import {
  IsUUID,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  IsOptional,
  IsDateString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// ─── Sub-DTOs ─────────────────────────────────────────────────────────────────

export class OcoLegDto {
  /**
   * Price at which this leg should trigger / be placed.
   * For stop-loss this is the stop price; for take-profit the limit price.
   */
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  triggerPrice!: number;

  /**
   * Amount to sell/buy when this leg triggers.
   * Can be omitted to default to the parent order amount.
   */
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  @IsOptional()
  amount?: number;
}

// ─── Main DTO ────────────────────────────────────────────────────────────────

export class CreateOcoOrderDto {
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

  // ── Order size ─────────────────────────────────────────────────────────────

  /** Default amount for both legs (individual legs may override) */
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  amount!: number;

  // ── OCO legs ───────────────────────────────────────────────────────────────

  @ValidateNested()
  @Type(() => OcoLegDto)
  stopLoss!: OcoLegDto;

  @ValidateNested()
  @Type(() => OcoLegDto)
  takeProfit!: OcoLegDto;

  // ── Optional ttl ───────────────────────────────────────────────────────────

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

// ─── Response DTOs ────────────────────────────────────────────────────────────

export class OcoOrderResponseDto {
  id!: string;
  userId!: string;
  positionId?: string;
  status!: string;
  sellingAssetCode!: string;
  buyingAssetCode!: string;
  stopLossTriggerPrice!: number;
  takeProfitTriggerPrice!: number;
  amount!: number;
  triggeredLeg?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

// ─── Cancel DTO ──────────────────────────────────────────────────────────────

export class CancelOcoOrderDto {
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
