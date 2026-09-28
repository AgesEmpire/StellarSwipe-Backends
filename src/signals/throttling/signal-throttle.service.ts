import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ThrottleConfigDto } from './dto/throttle-config.dto';

@Injectable()
export class SignalThrottleService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async checkThrottle(providerId: string, config: ThrottleConfigDto): Promise<boolean> {
    const key = `signal_throttle:${providerId}`;
    const currentCount = await this.cacheManager.get<number>(key) || 0;

    if (currentCount >= config.limit) {
      return false; // Throttled
    }

    await this.cacheManager.set(key, currentCount + 1, config.ttlSeconds * 1000);
    return true;
  }
}
