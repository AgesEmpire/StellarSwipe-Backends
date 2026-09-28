import { IsNotEmpty } from 'class-validator';
import { IsStellarPublicKey } from '../../common/decorators/validation.decorator';
import { NormalizeStellarKey } from '../../common/decorators/normalize-stellar-key.decorator';

export class UnlockAccountDto {
  @IsNotEmpty({ message: 'publicKey is required' })
  @NormalizeStellarKey()
  @IsStellarPublicKey({
    message: 'publicKey must be a valid Stellar public key starting with G',
  })
  publicKey!: string;
}
