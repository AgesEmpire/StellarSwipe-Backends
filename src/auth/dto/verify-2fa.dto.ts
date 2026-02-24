import { IsString, Length, IsOptional } from 'class-validator';

export class Verify2faDto {
  @IsOptional()
  @IsString()
  @Length(6, 6)
  token?: string; // 6-digit TOTP code

  @IsOptional()
  @IsString()
  @Length(10, 10)
  backupCode?: string; // 10-char backup code (used when authenticator unavailable)
}
