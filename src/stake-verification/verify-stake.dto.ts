import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStellarPublicKey } from '../common/decorators/is-stellar-address.decorator';

export class VerifyStakeDto {
  @ApiProperty({
    description: 'Stellar public key of the provider',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsStellarPublicKey({ message: 'publicKey must be a valid Stellar public key (56-char G... address)' })
  @IsNotEmpty()
  publicKey!: string;
}

export class StakeVerificationResponse {
  @ApiProperty()
  verified!: boolean;

  @ApiProperty()
  stakeAmount!: string;

  @ApiProperty()
  minimumRequired!: string;

  @ApiProperty()
  verifiedAt?: Date;

  @ApiProperty()
  message!: string;
}

export class VerificationStatusDto {
  @ApiProperty()
  isVerified!: boolean;

  @ApiProperty()
  stakeAmount!: string;

  @ApiProperty()
  lastChecked!: Date;

  @ApiProperty()
  expiresAt?: Date;
}