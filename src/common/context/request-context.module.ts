import {
  Global,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  Scope,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { NextFunction, Request, Response } from 'express';

export interface RequestContextData {
  tenantId?: string;
  userId?: string;
  locale?: string;
}

const TENANT_HEADERS = ['x-tenant-id', 'x-tenant'];
const USER_HEADERS = ['x-user-id', 'x-user'];
const LOCALE_HEADERS = ['x-locale', 'accept-language'];

function firstHeader(req: Request, names: string[]): string | undefined {
  for (const name of names) {
    const value = req.headers[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value) && value.length > 0 && value[0].trim().length > 0) {
      return value[0].trim();
    }
  }
  return undefined;
}

function normalizeLocale(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  // Accept-Language may be a list like "en-US,en;q=0.9"; keep the primary tag.
  const primary = value.split(',')[0]?.split(';')[0]?.trim();
  return primary && primary.length > 0 ? primary : undefined;
}

/**
 * Request-scoped store that exposes tenant, user, and locale data to services,
 * guards, and data access layers without threading the raw request through
 * every call site.
 */
@Injectable({ scope: Scope.DEFAULT })
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextData>();

  run<T>(data: RequestContextData, callback: () => T): T {
    return this.storage.run(data, callback);
  }

  get(): RequestContextData | undefined {
    return this.storage.getStore();
  }

  getTenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  getUserId(): string | undefined {
    return this.storage.getStore()?.userId;
  }

  getLocale(): string | undefined {
    return this.storage.getStore()?.locale;
  }
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const data: RequestContextData = {
      tenantId: firstHeader(req, TENANT_HEADERS),
      userId: firstHeader(req, USER_HEADERS),
      locale: normalizeLocale(firstHeader(req, LOCALE_HEADERS)),
    };

    this.context.run(data, () => next());
  }
}

@Global()
@Module({
  providers: [RequestContextService, RequestContextMiddleware],
  exports: [RequestContextService],
})
export class RequestContextModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
