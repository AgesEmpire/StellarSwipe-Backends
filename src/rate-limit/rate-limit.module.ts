import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { ApiKeyRateLimitService } from './api-key-rate-limit.service';

@Module({
  imports: [CacheModule, ConfigModule],
  providers: [ApiKeyRateLimitService],
  exports: [ApiKeyRateLimitService],
})
export class RateLimitModule {}
