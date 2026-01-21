import { Global, Module } from '@nestjs/common';
import { SentryService } from './sentry.service';

/**
 * Global Sentry module
 * Makes SentryService available throughout the application
 */
@Global()
@Module({
  providers: [SentryService],
  exports: [SentryService],
})
export class SentryModule {}
