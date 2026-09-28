import { AsyncLocalStorage } from 'async_hooks';
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Request-scoped tenant context exposed consistently to services, guards,
 * and data access layers.
 */
export interface RequestContext {
  tenantId?: string;
  userId?: string;
  locale?: string;
  requestId?: string;
}

const TENANT_HEADER = 'x-tenant-id';
const LOCALE_HEADER = 'accept-language';
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Holds the per-request context using AsyncLocalStorage so it is available
 * anywhere in the async call chain without threading it through arguments.
 */
@Injectable()
export class RequestContextProvider {
  private readonly logger = new Logger(RequestContextProvider.name);
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  /**
   * Runs the given callback within a fresh request context.
   */
  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  /**
   * Returns the current request context, or undefined when called outside
   * of a request scope.
   */
  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getTenantId(): string | undefined {
    return this.get()?.tenantId;
  }

  getUserId(): string | undefined {
    return this.get()?.userId;
  }

  getLocale(): string | undefined {
    return this.get()?.locale;
  }

  /**
   * Builds a context from an incoming request, deriving tenant, user, and
   * locale from headers and authenticated principal when available.
   */
  fromRequest(request: Request): RequestContext {
    const tenantId = this.readHeader(request, TENANT_HEADER);
    const locale = this.readHeader(request, LOCALE_HEADER);
    const requestId = this.readHeader(request, REQUEST_ID_HEADER);
    const userId = this.readUserId(request);

    if (!tenantId) {
      this.logger.debug(
        `Request ${requestId ?? 'unknown'} has no tenant header (${TENANT_HEADER})`,
      );
    }

    return { tenantId, userId, locale, requestId };
  }

  private readHeader(request: Request, name: string): string | undefined {
    const value = request.headers?.[name];
    if (Array.isArray(value)) {
      return value[0];
    }
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readUserId(request: Request): string | undefined {
    const user = (request as Request & { user?: { id?: string; sub?: string } })
      .user;
    return user?.id ?? user?.sub;
  }
}

/**
 * Middleware that establishes the request context for every incoming request
 * so downstream services, guards, and data access layers can inject it.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly contextProvider: RequestContextProvider) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    const context = this.contextProvider.fromRequest(request);
    this.contextProvider.run(context, () => next());
  }
}
