import { IsEmail, IsString, MinLength, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SanitizeEmail, SanitizeString } from '../../common/sanitizers/input.sanitizer';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @SanitizeEmail()
  email!: string;

  @ApiProperty({ example: 'Password123!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128, { message: 'password must not exceed 128 characters' })
  password!: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'displayName must not exceed 100 characters' })
  @SanitizeString()
  displayName?: string;

  @ApiPropertyOptional({ example: 'johndoe' })
  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'username must be at least 3 characters' })
  @MaxLength(50, { message: 'username must not exceed 50 characters' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'username may only contain letters, numbers, underscores, and hyphens',
  })
  @SanitizeString()
  username?: string;
}
