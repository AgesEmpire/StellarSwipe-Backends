import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'secure-reset-token' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'NewPassword123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
