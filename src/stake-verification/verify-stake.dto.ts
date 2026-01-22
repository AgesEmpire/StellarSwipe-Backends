import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyStakeDto {
  @ApiProperty({
    description: 'Stellar public key of the provider',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z0-9]{55}$/, {
    message: 'Invalid Stellar public key format',
  })
  publicKey: string;
}

export class StakeVerificationResponse {
  @ApiProperty()
  verified: boolean;

  @ApiProperty()
  stakeAmount: string;

  @ApiProperty()
  minimumRequired: string;

  @ApiProperty()
  verifiedAt?: Date;

  @ApiProperty()
  message: string;
}

export class VerificationStatusDto {
  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  stakeAmount: string;

  @ApiProperty()
  lastChecked: Date;

  @ApiProperty()
  expiresAt?: Date;
}