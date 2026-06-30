import { IsString, IsNotEmpty, IsOptional, IsArray, ArrayMinSize, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SponsoredOnboardingDto {
  @ApiProperty({ description: 'New user public key to create and sponsor' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Invalid Stellar public key' })
  newAccountPublicKey: string;

  /**
   * Starting balance sent to the new account (minimum 0 XLM when using sponsored reserves).
   * Defaults to '0' since the sponsor covers the base reserve.
   */
  @ApiPropertyOptional({ default: '0' })
  @IsOptional()
  @IsString()
  startingBalance?: string;

  @ApiPropertyOptional({
    description: 'List of assets (code:issuer) to add trustlines for during onboarding',
    example: ['USDC:GA5ZS...'],
  })
  @IsOptional()
  @IsArray()
  trustlineAssets?: string[];
}

export class RevokeSponsorshipDto {
  @ApiProperty({ description: 'The account whose sponsorship is being revoked/transferred' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'Invalid Stellar public key' })
  sponsoredAccountPublicKey: string;
}

export class SponsoredOnboardingResultDto {
  hash: string;
  newAccountPublicKey: string;
  sponsorAccount: string;
  trustlinesCreated: number;
}
