import { ApiProperty } from '@nestjs/swagger';

export class TrustlineDto {
  @ApiProperty({ description: 'Asset code', example: 'USDC' })
  assetCode: string;

  @ApiProperty({ 
    description: 'Asset issuer public key',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
  })
  assetIssuer: string;

  @ApiProperty({ description: 'Current balance', example: '1000.0000000' })
  balance: string;

  @ApiProperty({ description: 'Trustline limit', example: '922337203685.4775807' })
  limit: string;

  @ApiProperty({ description: 'Whether the trustline is authorized', example: true })
  authorized: boolean;
}

export class TrustlineStatusDto {
  @ApiProperty({
    description: 'Account public key',
    example: 'GCLWGQPMKXQSPF776IU33AH4PZNOOWNAWGGKVTBQMIC5IMKUNP3E6NVU'
  })
  publicKey: string;

  @ApiProperty({ description: 'Current number of trustlines', example: 5 })
  trustlineCount: number;

  @ApiProperty({ description: 'Maximum allowed trustlines', example: 1000 })
  maxTrustlines: number;

  @ApiProperty({ description: 'Whether account can create more trustlines', example: true })
  canCreateMore: boolean;

  @ApiProperty({ description: 'Current XLM balance', example: '100.0000000' })
  xlmBalance: string;

  @ApiProperty({ description: 'XLM reserve required per trustline', example: '0.5' })
  reserveRequired: string;

  @ApiProperty({ 
    description: 'List of existing trustlines',
    type: [TrustlineDto]
  })
  trustlines: TrustlineDto[];
}