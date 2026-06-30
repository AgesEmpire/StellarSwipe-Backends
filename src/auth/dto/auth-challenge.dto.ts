
import { IsOptional, IsString } from 'class-validator';
import { IsStellarPublicKey } from '../../common/decorators/validation.decorator';
import { NormalizeStellarKey } from '../../common/decorators/normalize-stellar-key.decorator';

export class AuthChallengeDto {
  @IsOptional()
  @NormalizeStellarKey()
  @IsStellarPublicKey()
  publicKey?: string;
}
