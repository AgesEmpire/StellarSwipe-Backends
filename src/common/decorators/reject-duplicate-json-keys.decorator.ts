import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import {
  REJECT_DUPLICATE_JSON_KEYS_KEY,
  RejectDuplicateJsonKeysGuard,
} from '../guards/reject-duplicate-json-keys.guard';

/**
 * Marks a security-sensitive controller or handler — authentication,
 * authorization, or transaction mutations — so its JSON request body is
 * re-validated for ambiguous duplicate object keys (#1383), on top of
 * ordinary `class-validator` validation.
 *
 * Apply at the controller level to cover every handler on it, or on an
 * individual handler to opt in a single route.
 *
 * @example
 * ```ts
 * @RejectDuplicateJsonKeys()
 * @Controller('auth')
 * export class AuthController { ... }
 * ```
 */
export const RejectDuplicateJsonKeys = () =>
  applyDecorators(
    SetMetadata(REJECT_DUPLICATE_JSON_KEYS_KEY, true),
    UseGuards(RejectDuplicateJsonKeysGuard),
  );
