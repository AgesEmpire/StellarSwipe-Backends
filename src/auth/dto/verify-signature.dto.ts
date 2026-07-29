import { IsNotEmpty, IsString } from 'class-validator';
import { SanitizeString } from '../../common/sanitizers/input.sanitizer';
import { IsStellarPublicKey } from '../../common/decorators/validation.decorator';

export class VerifySignatureDto {
  @IsNotEmpty({ message: 'publicKey is required' })
  @IsStellarPublicKey({ message: 'publicKey must be a valid Stellar public key starting with G' })
  @SanitizeString()
  publicKey!: string;

  @IsNotEmpty({ message: 'signature is required' })
  @IsString()
  @SanitizeString()
  signature!: string;

  @IsNotEmpty({ message: 'message is required' })
  @IsString()
  @SanitizeString()
  message!: string;
}
