import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SanitizeBoolean, SanitizeString } from '../sanitizers/input.sanitizer';
import { IsStellarPublicKey } from '../decorators/validation.decorator';

/**
 * Base DTO for identifying a user by their UUID.
 */
export class UserIdentifierDto {
  @IsNotEmpty({ message: 'userId is required' })
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId!: string;
}

/**
 * Base DTO for creating a new user account.
 * Uses the shared @IsStellarPublicKey validator for wallet address validation.
 */
export class CreateUserBaseDto {
  @IsNotEmpty({ message: 'username is required' })
  @IsString()
  @Length(3, 50, { message: 'username must be between 3 and 50 characters' })
  @SanitizeString()
  username!: string;

  @ApiPropertyOptional({
    description: 'Stellar wallet public key',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AUCR6C24',
  })
  @IsOptional()
  @IsStellarPublicKey({ message: 'walletAddress must be a valid Stellar public key starting with G' })
  @SanitizeString()
  walletAddress?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsString()
  @SanitizeString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @Length(1, 100, { message: 'displayName must be between 1 and 100 characters' })
  @SanitizeString()
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500, { message: 'bio must be between 1 and 500 characters' })
  @SanitizeString()
  bio?: string;
}

/**
 * Base DTO for updating a user's profile information.
 * All fields are optional to support partial updates.
 */
export class UpdateUserProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @Length(1, 100, { message: 'displayName must be between 1 and 100 characters' })
  @SanitizeString()
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500, { message: 'bio must be between 1 and 500 characters' })
  @SanitizeString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  @SanitizeString()
  language?: string;
}

/**
 * Base DTO for updating user notification preferences.
 */
export class UserNotificationPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @SanitizeBoolean()
  emailNotifications?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @SanitizeBoolean()
  pushNotifications?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @SanitizeBoolean()
  tradeNotifications?: boolean;
}
