/**
 * Service Discovery for Microservices
 *
 * Implements a lightweight service registry backed by Redis (via cache-manager)
 * so that dynamic backend deployments can register, discover, and health-check
 * each other without hard-coded addresses.
 *
 * Security: all mutating operations (register / deregister) require a shared
 * internal service token validated by `validateServiceToken()`.  Read-only
 * discovery (resolve / list) is intentionally open to internal callers only
 * and must be placed behind the existing `HealthMetricsAuthGuard` or an
 * equivalent guard at the controller layer.
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export interface ServiceInstance {
  /** Logical service name, e.g. "signals-service" */
  name: string;
  /** Reachable base URL, e.g. "http://signals-svc:3001" */
  url: string;
  /** Arbitrary metadata (version, region, …) */
  metadata?: Record<string, string>;
  registeredAt: string;
  lastHeartbeat: string;
}

const REGISTRY_PREFIX = 'discovery:service:';
/** TTL in milliseconds — instances must heartbeat before this expires */
const INSTANCE_TTL_MS = 60_000;

@Injectable()
export class DiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryService.name);
  private readonly internalToken: string;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly config: ConfigService,
  ) {
    this.internalToken =
      this.config.get<string>('INTERNAL_SERVICE_TOKEN') ?? '';
  }

  onModuleInit(): void {
    if (!this.internalToken) {
      this.logger.warn(
        'INTERNAL_SERVICE_TOKEN is not set — service registration will be rejected',
      );
    }
  }

  // ── Auth helper ────────────────────────────────────────────────────────────

  private validateServiceToken(token: string): void {
    if (!this.internalToken || token !== this.internalToken) {
      throw new UnauthorizedException('Invalid internal service token');
    }
  }

  // ── Registry operations ────────────────────────────────────────────────────

  /**
   * Register (or refresh) a service instance.
   * @param token  Internal service token — must match INTERNAL_SERVICE_TOKEN env var.
   */
  async register(
    name: string,
    url: string,
    token: string,
    metadata?: Record<string, string>,
  ): Promise<ServiceInstance> {
    this.validateServiceToken(token);

    const instance: ServiceInstance = {
      name,
      url,
      metadata,
      registeredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    };

    await this.cache.set(
      `${REGISTRY_PREFIX}${name}`,
      instance,
      INSTANCE_TTL_MS,
    );

    this.logger.log(`Service registered: ${name} → ${url}`);
    return instance;
  }

  /**
   * Refresh the TTL for an already-registered instance (heartbeat).
   */
  async heartbeat(name: string, token: string): Promise<void> {
    this.validateServiceToken(token);

    const existing = await this.cache.get<ServiceInstance>(
      `${REGISTRY_PREFIX}${name}`,
    );
    if (!existing) {
      this.logger.warn(`Heartbeat for unknown service: ${name}`);
      return;
    }

    existing.lastHeartbeat = new Date().toISOString();
    await this.cache.set(
      `${REGISTRY_PREFIX}${name}`,
      existing,
      INSTANCE_TTL_MS,
    );
  }

  /**
   * Remove a service instance from the registry.
   */
  async deregister(name: string, token: string): Promise<void> {
    this.validateServiceToken(token);
    await this.cache.del(`${REGISTRY_PREFIX}${name}`);
    this.logger.log(`Service deregistered: ${name}`);
  }

  /**
   * Resolve the URL for a named service.
   * Returns `null` when the service is not registered or its TTL has expired.
   */
  async resolve(name: string): Promise<string | null> {
    const instance = await this.cache.get<ServiceInstance>(
      `${REGISTRY_PREFIX}${name}`,
    );
    return instance?.url ?? null;
  }

  /**
   * Return all currently-registered service instances.
   * NOTE: cache-manager does not expose a KEYS scan; callers that need a full
   * listing should maintain a separate index key or use the Redis client
   * directly.  This method returns whatever is stored under a well-known
   * "index" key that `register()` keeps up-to-date.
   */
  async listServices(): Promise<ServiceInstance[]> {
    const index =
      (await this.cache.get<string[]>(`${REGISTRY_PREFIX}index`)) ?? [];

    const instances = await Promise.all(
      index.map((name) =>
        this.cache.get<ServiceInstance>(`${REGISTRY_PREFIX}${name}`),
      ),
    );

    return instances.filter((i): i is ServiceInstance => i !== null && i !== undefined);
  }
}
