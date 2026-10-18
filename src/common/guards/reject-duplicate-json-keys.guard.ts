import { Injectable, CanActivate, ExecutionContext, BadRequestException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DuplicateJsonKeyError, parseJsonRejectingDuplicateKeys } from '../json/strict-json-parser';

export const REJECT_DUPLICATE_JSON_KEYS_KEY = 'reject_duplicate_json_keys';

/**
 * Re-validates the raw JSON body of a request against the policy that
 * ambiguous duplicate object keys are not allowed on security-sensitive
 * endpoints (#1383) — authentication, authorization, and transaction
 * mutation surfaces, where two different readers of the same payload (e.g.
 * a validation/signature-check step vs. the handler that executes the
 * action) disagreeing about which of two values for the same key is "the"
 * value is a real attack, not a cosmetic bug.
 *
 * Opt-in via the `@RejectDuplicateJsonKeys()` decorator (controller- or
 * handler-level) rather than global, so ordinary JSON bodies elsewhere in
 * the API are completely unaffected.
 *
 * Relies on `request.rawBody`, which NestJS's body-parser populates
 * whenever `rawBody: true` is passed to `NestFactory.create` (already the
 * case — see `main.ts`) — the exact bytes `JSON.parse` saw, before
 * `JSON.parse` silently collapsed any duplicate keys.
 */
@Injectable()
export class RejectDuplicateJsonKeysGuard implements CanActivate {
  private readonly logger = new Logger(RejectDuplicateJsonKeysGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled = this.reflector.getAllAndOverride<boolean>(REJECT_DUPLICATE_JSON_KEYS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const contentType = String(request.headers?.['content-type'] ?? '');

    if (!request.rawBody || request.rawBody.length === 0 || !contentType.includes('application/json')) {
      // Nothing to re-check: no JSON object literal in the body for a
      // duplicate key to hide in (e.g. multipart, query-only, empty body).
      return true;
    }

    try {
      parseJsonRejectingDuplicateKeys(request.rawBody.toString('utf8'));
    } catch (error) {
      if (error instanceof DuplicateJsonKeyError) {
        throw new BadRequestException(
          `Request body contains an ambiguous duplicate JSON key: "${error.key}"`,
        );
      }
      // Malformed JSON is `body-parser`'s job to reject before this guard
      // ever runs. If this simplified grammar disagrees with the standard
      // `JSON.parse` result for some edge case, fail open here rather than
      // block an otherwise well-formed, already-accepted request.
      this.logger.warn(
        `Duplicate-key re-validation could not parse an already-accepted JSON body: ${(error as Error).message}`,
      );
      return true;
    }

    return true;
  }
}
