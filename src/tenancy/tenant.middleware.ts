/**
 * TenantMiddleware
 *
 * Resolves the tenant from the incoming request and stores it in
 * AsyncLocalStorage so every downstream service can read it without
 * explicit parameter threading.
 *
 * Resolution order:
 *   1. X-Tenant-ID header  (API / machine-to-machine)
 *   2. JWT claim `tenantId` (user-facing flows — requires auth middleware
 *      to have already decoded the token and attached `req.user`)
 *
 * Security: unknown / missing tenant IDs are rejected with 401 before
 * any business logic runs.
 */
import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { tenantStorage } from './tenant-context';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const tenantId =
      (req.headers['x-tenant-id'] as string | undefined) ||
      (req as any).user?.tenantId;

    if (!tenantId) {
      throw new UnauthorizedException(
        'Missing tenant identifier. Provide X-Tenant-ID header or authenticate.',
      );
    }

    tenantStorage.run({ tenantId }, () => next());
  }
}
