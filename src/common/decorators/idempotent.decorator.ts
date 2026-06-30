import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export const IDEMPOTENT_KEY = 'isIdempotent';

/**
 * Marks a controller method as idempotent and auto-documents the Idempotency-Key header
 * in Swagger. The decorated route MUST have IdempotencyInterceptor wired through
 * UseInterceptors, or a startup check will fail.
 *
 * Usage:
 * @Idempotent()
 * async executeAction() { ... }
 */
export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT_KEY, true),
    ApiHeader({
      name: 'Idempotency-Key',
      description:
        'Unique key for safe retries. The API returns the same response for identical payloads ' +
        'within 24 hours. If you retry with the same key but different payload, the API returns 422. ' +
        'Format: any string, max 255 characters.',
      required: false,
      example: '550e8400-e29b-41d4-a716-446655440000',
      schema: {
        type: 'string',
        maxLength: 255,
      },
    }),
  );
