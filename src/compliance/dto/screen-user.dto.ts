import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScreenWalletDto {
  @IsString()
  @IsNotEmpty()
  address: string;
}

export class ScreenUserDto {
  @IsOptional()
  @IsString()
  walletAddress?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
