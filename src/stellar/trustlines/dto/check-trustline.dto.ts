import { OmitType } from '@nestjs/swagger';
import { CreateTrustlineDto } from './create-trustline.dto';

/**
 * Payload for pre-trade trustline checks — same account/asset shape as
 * CreateTrustlineDto minus the secret key (no signing occurs) and limit.
 */
export class CheckTrustlineDto extends OmitType(CreateTrustlineDto, [
  'secretKey',
  'limit',
] as const) {}

/**
 * Payload for auto-creating a trustline ahead of a trade. Same shape as
 * CreateTrustlineDto minus the optional limit (auto-created trustlines use
 * the maximum limit).
 */
export class AutoCreateTrustlineDto extends OmitType(CreateTrustlineDto, [
  'limit',
] as const) {}
