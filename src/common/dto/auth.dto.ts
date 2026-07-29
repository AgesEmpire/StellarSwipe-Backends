import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SanitizeEmail, SanitizeString } from '../sanitizers/input.sanitizer';
import { IsStellarPublicKey } from '../decorators/validation.decorator';

/**
 * Base DTO for requesting a Stellar wallet authentication challenge.
 * Modules can extend or compose this DTO for challenge-based auth flows.
 */
export class StellarChallengeRequestDto {
  @ApiProperty({
    description: 'Stellar public key (G-prefix, 56 characters)',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsNotEmpty({ message: 'publicKey is required' })
  @IsStellarPublicKey({ message: 'publicKey must be a valid Stellar public key starting with G' })
  @SanitizeString()
  publicKey!: string;
}

/**
 * Base DTO for verifying a Stellar wallet signature.
 * Provides strict validation of all three required fields for signature verification.
 */
export class StellarSignatureVerificationDto {
  @ApiProperty({
    description: 'Stellar public key that signed the challenge',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsNotEmpty({ message: 'publicKey is required' })
  @IsStellarPublicKey({ message: 'publicKey must be a valid Stellar public key starting with G' })
  @SanitizeString()
  publicKey!: string;

  @ApiProperty({
    description: 'Base64-encoded signature of the challenge message',
  })
  @IsNotEmpty({ message: 'signature is required' })
  @IsString()
  @SanitizeString()
  signature!: string;

  @ApiProperty({
    description: 'The original challenge message that was signed',
  })
  @IsNotEmpty({ message: 'message is required' })
  @IsString()
  @SanitizeString()
  message!: string;
}

/**
 * Base DTO for email/password registration.
 * Includes sanitization and strong password requirements.
 */
export class EmailRegistrationDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty({ message: 'email is required' })
  @SanitizeEmail()
  email!: string;

  @ApiProperty({ example: 'Password123!', minLength: 8 })
  @IsNotEmpty({ message: 'password is required' })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128, { message: 'password must not exceed 128 characters' })
  password!: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'displayName must not exceed 100 characters' })
  @SanitizeString()
  displayName?: string;

  @ApiPropertyOptional({ example: 'johndoe' })
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'username must be at least 3 characters' })
  @MaxLength(50, { message: 'username must not exceed 50 characters' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'username may only contain letters, numbers, underscores, and hyphens',
  })
  @SanitizeString()
  username?: string;
}

/**
 * Base DTO for requesting a password reset email.
 */
export class PasswordResetRequestDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty({ message: 'email is required' })
  @SanitizeEmail()
  email!: string;
}

/**
 * Base DTO for completing a password reset with a token.
 */
export class PasswordResetConfirmDto {
  @ApiProperty({ description: 'Password reset token received via email' })
  @IsNotEmpty({ message: 'token is required' })
  @IsString()
  @SanitizeString()
  token!: string;

  @ApiProperty({ example: 'NewPassword123!', minLength: 8 })
  @IsNotEmpty({ message: 'newPassword is required' })
  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters' })
  @MaxLength(128, { message: 'newPassword must not exceed 128 characters' })
  newPassword!: string;
}
