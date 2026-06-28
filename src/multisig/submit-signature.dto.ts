import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsBase64,
  Length,
  Matches,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsStellarMemo } from '../common/decorators/is-stellar-memo.decorator';
import { StellarMemoDto } from '../common/dto/stellar-memo.dto';

export class SubmitSignatureDto {
  @ApiProperty({
    description: 'UUID of the pending transaction to sign',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID()
  pendingTransactionId: string;

  @ApiProperty({
    description: 'Stellar public key (G…) of the signer',
    example: 'GABC...XYZ',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Invalid Stellar public key format' })
  signerPublicKey: string;

  @ApiProperty({
    description: 'Base64-encoded 64-byte Ed25519 signature over the transaction hash',
  })
  @IsString()
  @IsNotEmpty()
  @IsBase64()
  @Length(88, 88, { message: 'Signature must be exactly 88 base64 characters (64 bytes)' })
  signature: string;
}

export class CreatePendingTransactionDto {
  @ApiProperty({
    description: 'Stellar account ID that owns this multisig',
    example: 'GABC...XYZ',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Invalid Stellar account ID format' })
  accountId: string;

  @ApiProperty({
    description: 'Base64-encoded XDR of the unsigned or partially-signed transaction envelope',
  })
  @IsString()
  @IsNotEmpty()
  @IsBase64()
  transactionXdr: string;

  @ApiPropertyOptional({ description: 'Human-readable memo for the transaction' })
  @IsOptional()
  @IsString()
  memo?: string;

  @ApiPropertyOptional({
    description:
      'Structured memo (type + value) validated against Stellar per-type ' +
      'constraints before the transaction is built.',
    type: StellarMemoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => StellarMemoDto)
  @IsStellarMemo()
  memoDetails?: StellarMemoDto;

  @ApiPropertyOptional({
    description: 'Additional metadata to store alongside the transaction',
    example: { requesterId: 'user-123', description: 'Monthly settlement' },
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
