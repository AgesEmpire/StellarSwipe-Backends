import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextData {
  tenantId?: string;
  userId?: string;
  locale?: string;
  requestId?: string;
}

/**
 * Request-scoped context store. Exposes tenant, user, and locale data
 * consistently to services, guards, and data access layers via
 * AsyncLocalStorage so the context propagates across async boundaries.
 */
@Injectable()
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

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }
}

const TENANT_HEADER = 'x-tenant-id';
const USER_HEADER = 'x-user-id';
const LOCALE_HEADER = 'accept-language';
const REQUEST_ID_HEADER = 'x-request-id';

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseLocale(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  // Accept-Language may be a comma-separated preference list; take the first.
  const primary = value.split(',')[0]?.trim();
  return primary || undefined;
}

/**
 * Middleware that builds the request context from incoming headers/auth
 * and runs the downstream request within the AsyncLocalStorage scope.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestContextMiddleware.name);

  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const authUser = (req as Request & { user?: { id?: string; tenantId?: string } }).user;

    const context: RequestContextData = {
      tenantId: firstHeader(req.headers[TENANT_HEADER]) ?? authUser?.tenantId,
      userId: firstHeader(req.headers[USER_HEADER]) ?? authUser?.id,
      locale: parseLocale(firstHeader(req.headers[LOCALE_HEADER])),
      requestId: firstHeader(req.headers[REQUEST_ID_HEADER]),
    };

    if (context.requestId) {
      res.setHeader(REQUEST_ID_HEADER, context.requestId);
    }

    this.logger.debug(
      `Request context tenant=${context.tenantId ?? 'none'} user=${context.userId ?? 'none'} locale=${context.locale ?? 'none'}`,
    );

    this.requestContext.run(context, () => next());
  }
}
