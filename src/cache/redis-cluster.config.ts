import { CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { RedisClientOptions } from 'redis';

export const createRedisClusterConfig = async (
  configService: ConfigService,
): Promise<CacheModuleOptions> => {
  const redisConfig: RedisClientOptions = {
    socket: {
      host: configService.get('redis.host', 'localhost'),
      port: configService.get('redis.port', 6379),
      connectTimeout: 10000,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          return new Error('Redis connection failed after 10 retries');
        }
        return Math.min(retries * 100, 3000);
      },
    },
    password: configService.get('redis.password'),
    database: configService.get('redis.database', 0),
  };

  // Enable clustering if configured
  const clusterEnabled = configService.get('redis.cluster.enabled', false);
  if (clusterEnabled) {
    const clusterNodes = configService.get('redis.cluster.nodes', []);
    if (clusterNodes.length > 0) {
      // Redis cluster configuration
      return {
        store: await redisStore({
          ...redisConfig,
          // @ts-ignore - cluster options
          cluster: {
            nodes: clusterNodes,
            options: {
              redisOptions: redisConfig,
            },
          },
        }),
        ttl: configService.get('redis.ttl', 3600) * 1000,
        max: configService.get('redis.maxItems', 1000),
      };
    }
  }

  // Standard Redis configuration
  return {
    store: await redisStore(redisConfig),
    ttl: configService.get('redis.ttl', 3600) * 1000,
    max: configService.get('redis.maxItems', 1000),
  };
};
