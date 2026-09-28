import { Module, Global } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Global module providing idempotency key support for payment-like mutations.
 *
 * Consumers can apply the exported `IdempotencyInterceptor` to any controller
 * or route handler that performs a non-idempotent mutation (e.g. charging a
 * card, creating a payout). The interceptor requires a client-supplied
 * `Idempotency-Key` header, persists the result state keyed by that value, and
 * replays the original response on retries instead of reprocessing.
 */
@Global()
@Module({
  providers: [IdempotencyService, IdempotencyInterceptor],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
