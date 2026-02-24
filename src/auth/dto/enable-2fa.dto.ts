import { IsString, Length } from 'class-validator';

/**
 * Used during the final step of enrollment to confirm the user has successfully
 * scanned the QR code and their authenticator app is generating valid codes.
 */
export class Enable2faDto {
  @IsString()
  @Length(6, 6)
  token!: string; // TOTP code from authenticator app
}
