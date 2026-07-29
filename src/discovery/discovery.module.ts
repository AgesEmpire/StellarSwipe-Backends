import { Module } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [CacheModule],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
