import { Global, Module } from '@nestjs/common';
import { CorrelationIdStore } from './correlation-id.store';
import { CorrelationIdMiddleware } from '../middleware/correlation-id.middleware';

/**
 * Global module exposing request-scoped correlation context to the whole
 * application, so any module can tag its logs with the current request's
 * correlation ID without an explicit import.
 */
@Global()
@Module({
  providers: [CorrelationIdStore, CorrelationIdMiddleware],
  exports: [CorrelationIdStore, CorrelationIdMiddleware],
})
export class CorrelationModule {}
