import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { CliCommand } from '../../interfaces/cli-command.interface';

@Injectable()
export class ClearCacheCommand implements CliCommand {
  name = 'maintenance:clear-cache';
  description = 'Clear application cache. Usage: maintenance:clear-cache [--key=<key>]';

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async run(args: string[]): Promise<void> {
    const key = args.find((a) => a.startsWith('--key='))?.split('=')[1];

    if (key) {
      await this.cache.del(key);
      console.log(`✓ Cache key "${key}" cleared.`);
    } else {
      await this.cache.reset();
      console.log('✓ All cache cleared.');
    }
  }
}
