import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Matches, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ClaimPredicateType {
  UNCONDITIONAL = 'UNCONDITIONAL',
  BEFORE_ABSOLUTE_TIME = 'BEFORE_ABSOLUTE_TIME',
  BEFORE_RELATIVE_TIME = 'BEFORE_RELATIVE_TIME',
}

export class CreateClaimableBalanceDto {
  /** Sponsor/issuer secret key that funds the balance */
  @IsString()
  @IsNotEmpty()
  sponsorSecretKey: string;

  @ApiProperty({ description: 'Stellar public key of the recipient/claimant' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Invalid Stellar public key' })
  recipientAddress: string;

  @ApiProperty({ description: 'Asset code (XLM for native)' })
  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @ApiPropertyOptional({ description: 'Asset issuer (omit for XLM)' })
  @IsOptional()
  @IsString()
  assetIssuer?: string;

  @ApiProperty({ description: 'Amount to lock in the claimable balance' })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiPropertyOptional({ enum: ClaimPredicateType, default: ClaimPredicateType.UNCONDITIONAL })
  @IsOptional()
  @IsEnum(ClaimPredicateType)
  predicateType?: ClaimPredicateType;

  /**
   * Unix timestamp (absolute) or seconds (relative) depending on predicateType.
   * Required when predicateType is not UNCONDITIONAL.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  predicateValue?: number;
}

export class ClaimBalanceDto {
  /** Claimant's secret key */
  @IsString()
  @IsNotEmpty()
  claimantSecretKey: string;

  @ApiProperty({ description: 'Claimable balance ID' })
  @IsString()
  @IsNotEmpty()
  balanceId: string;
}

export class ReclaimExpiredBalanceDto {
  /** Sponsor/issuer secret key */
  @IsString()
  @IsNotEmpty()
  sponsorSecretKey: string;

  @ApiProperty({ description: 'Claimable balance ID to reclaim' })
  @IsString()
  @IsNotEmpty()
  balanceId: string;
}
