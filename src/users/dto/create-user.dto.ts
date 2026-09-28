import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Length,
  MinLength,
} from 'class-validator';
import { SanitizeString } from '../../common/sanitizers/input.sanitizer';
import { IsStellarPublicKey } from '../../common/decorators/validation.decorator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 50)
  @SanitizeString()
  username!: string;

  @IsOptional()
  @IsStellarPublicKey({ message: 'walletAddress must be a valid Stellar public key starting with G' })
  @SanitizeString()
  walletAddress?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @SanitizeString()
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  @SanitizeString()
  bio?: string;
}
