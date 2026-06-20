import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SanitizeAssetCode,
  SanitizeString,
} from '../sanitizers/input.sanitizer';
import {
  IsStellarPublicKey,
  IsStellarSecretKey,
  IsValidAmount,
} from '../decorators/validation.decorator';

/**
 * Base DTO for operations that require only a Stellar public key.
 */
export class StellarPublicKeyDto {
  @ApiProperty({
    description: 'Stellar account public key (G-prefix, 56 characters)',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsNotEmpty({ message: 'publicKey is required' })
  @IsStellarPublicKey({ message: 'publicKey must be a valid Stellar public key starting with G' })
  @SanitizeString()
  publicKey!: string;
}

/**
 * Base DTO for identifying a Stellar asset by its code and issuer.
 */
export class StellarAssetDto {
  @ApiProperty({
    description: 'Asset code (e.g. USDC, XLM)',
    example: 'USDC',
    maxLength: 12,
  })
  @IsNotEmpty({ message: 'assetCode is required' })
  @IsString()
  @MinLength(1)
  @MaxLength(12, { message: 'assetCode must not exceed 12 characters' })
  @SanitizeAssetCode()
  assetCode!: string;

  @ApiProperty({
    description: 'Stellar public key of the asset issuer',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsNotEmpty({ message: 'assetIssuer is required' })
  @IsStellarPublicKey({ message: 'assetIssuer must be a valid Stellar public key starting with G' })
  @SanitizeString()
  assetIssuer!: string;
}

/**
 * Base DTO for trustline operations.
 * Combines account identification, asset identification, and an optional limit.
 */
export class StellarTrustlineBaseDto {
  @ApiProperty({
    description: 'Stellar account public key to establish the trustline for',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsNotEmpty({ message: 'publicKey is required' })
  @IsStellarPublicKey({ message: 'publicKey must be a valid Stellar public key starting with G' })
  @SanitizeString()
  publicKey!: string;

  @ApiProperty({
    description: 'Secret key of the account (used to sign the transaction)',
    example: 'SAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsNotEmpty({ message: 'secretKey is required' })
  @IsStellarSecretKey({ message: 'secretKey must be a valid Stellar secret key starting with S' })
  @SanitizeString()
  secretKey!: string;

  @ApiProperty({
    description: 'Asset code for the trustline',
    example: 'USDC',
    maxLength: 12,
  })
  @IsNotEmpty({ message: 'assetCode is required' })
  @IsString()
  @MaxLength(12, { message: 'assetCode must not exceed 12 characters' })
  @SanitizeAssetCode()
  assetCode!: string;

  @ApiProperty({
    description: 'Stellar public key of the asset issuer',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsNotEmpty({ message: 'assetIssuer is required' })
  @IsStellarPublicKey({ message: 'assetIssuer must be a valid Stellar public key starting with G' })
  @SanitizeString()
  assetIssuer!: string;

  @ApiPropertyOptional({
    description: 'Maximum trustline limit (numeric string, up to 7 decimal places)',
    example: '1000.0000000',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'limit must be a numeric string' })
  limit?: string;
}

/**
 * Base DTO for Stellar payment / send operations.
 */
export class StellarPaymentBaseDto {
  @ApiProperty({
    description: 'Sender Stellar public key',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsNotEmpty({ message: 'fromPublicKey is required' })
  @IsStellarPublicKey({ message: 'fromPublicKey must be a valid Stellar public key starting with G' })
  @SanitizeString()
  fromPublicKey!: string;

  @ApiProperty({
    description: 'Recipient Stellar public key',
    example: 'GBHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C25',
  })
  @IsNotEmpty({ message: 'toPublicKey is required' })
  @IsStellarPublicKey({ message: 'toPublicKey must be a valid Stellar public key starting with G' })
  @SanitizeString()
  toPublicKey!: string;

  @ApiProperty({
    description: 'Amount to send (positive, max 7 decimal places)',
    example: '10.5000000',
  })
  @IsNotEmpty({ message: 'amount is required' })
  @IsValidAmount({ message: 'amount must be a positive number with up to 7 decimal places within Stellar limits' })
  amount!: string;

  @ApiPropertyOptional({
    description: 'Optional memo for the transaction',
    maxLength: 28,
  })
  @IsOptional()
  @IsString()
  @MaxLength(28, { message: 'memo must not exceed 28 characters' })
  @SanitizeString()
  memo?: string;
}
