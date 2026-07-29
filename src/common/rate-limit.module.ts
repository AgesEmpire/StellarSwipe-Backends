import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { CacheModule } from '../cache/cache.module';

/**
 * #942 — Registers the app-wide throttling/rate-limit guards.
 *
 * Not @Global(): APP_GUARD providers apply application-wide via Nest's
 * special DI token regardless of module scope, so global visibility here
 * was redundant. Imported once by AppModule, which is all local scope needs.
 */
@Module({
  imports: [CacheModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
  exports: [RateLimitGuard],
})
export class RateLimitModule {}