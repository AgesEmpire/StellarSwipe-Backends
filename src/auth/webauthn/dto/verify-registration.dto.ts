import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { SanitizeString } from '../../../common/sanitizers/input.sanitizer';

export class VerifyRegistrationDto {
  @IsNotEmpty({ message: 'attestationResponse is required' })
  @IsObject()
  attestationResponse!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'deviceName must not exceed 100 characters' })
  @SanitizeString()
  deviceName?: string;
}
