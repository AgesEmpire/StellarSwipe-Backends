import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HttpRetryService } from './http-retry.service';

/**
 * HttpRetryModule
 *
 * Provides HttpRetryService globally. Import this module in any feature
 * module that makes outbound third-party HTTP calls and needs safe
 * exponential-backoff retry behaviour.
 *
 * Example:
 *   @Module({ imports: [HttpRetryModule] })
 *   export class PricesModule {}
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 10_000,
      maxRedirects: 3,
    }),
  ],
  providers: [HttpRetryService],
  exports: [HttpRetryService],
})
export class HttpRetryModule {}
