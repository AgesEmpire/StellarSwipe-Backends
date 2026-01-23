import { IsString, IsOptional, IsNotEmpty, Matches, IsNumberString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTrustlineDto {
  @ApiProperty({
    description: 'Account public key (Stellar address)',
    example: 'GCLWGQPMKXQSPF776IU33AH4PZNOOWNAWGGKVTBQMIC5IMKUNP3E6NVU',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z0-9]{55}$/, { message: 'Invalid Stellar public key format' })
  publicKey: string;

  @ApiProperty({
    description: 'Account secret key for signing transactions',
    example: 'SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^S[A-Z0-9]{55}$/, { message: 'Invalid Stellar secret key format' })
  secretKey: string;

  @ApiProperty({
    description: 'Asset code (e.g., USDC, BTC)',
    example: 'USDC',
  })
  @IsString()
  @IsNotEmpty()
  assetCode: string;

  @ApiProperty({
    description: 'Asset issuer public key',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z0-9]{55}$/, { message: 'Invalid asset issuer public key format' })
  assetIssuer: string;

  @ApiPropertyOptional({
    description: 'Trustline limit (optional, defaults to maximum)',
    example: '1000000',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'Limit must be a valid number string' })
  limit?: string;
}