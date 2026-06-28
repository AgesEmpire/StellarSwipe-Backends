import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { StellarMemoType } from '../validators/stellar-memo.validator';

/**
 * Structured Stellar memo. Pair a memo `type` with its `value` so the value
 * can be validated against the type-specific constraints (see
 * {@link IsStellarMemo}).
 */
export class StellarMemoDto {
  @ApiPropertyOptional({
    enum: StellarMemoType,
    description: 'Stellar memo type',
    example: StellarMemoType.TEXT,
  })
  @IsEnum(StellarMemoType)
  type!: StellarMemoType;

  @ApiPropertyOptional({
    description:
      'Memo value. text: up to 28 UTF-8 bytes; id: numeric string (uint64); ' +
      'hash/return: 64-char hex (32-byte) hash; none: omit.',
    example: 'order-1234',
  })
  @IsOptional()
  @IsString()
  value?: string;
}
