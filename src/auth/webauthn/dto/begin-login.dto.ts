import { IsOptional, IsString } from 'class-validator';
import { SanitizeString } from '../../../common/sanitizers/input.sanitizer';

export class BeginWebauthnLoginDto {
  /**
   * Optional username to scope the allowed credential list. When omitted,
   * the browser is asked to use any discoverable passkey it has stored
   * for this relying party.
   */
  @IsOptional()
  @IsString()
  @SanitizeString()
  username?: string;
}
