import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { AdminAccessPolicyService } from './admin-access-policy.service';

@Injectable()
export class AdminAccessGuard extends AuthGuard('jwt') {
  constructor(private readonly adminPolicy: AdminAccessPolicyService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!this.isAdminPath(request)) {
      return true;
    }

    const authenticated = await super.canActivate(context);
    if (!authenticated) {
      return false;
    }

    await this.adminPolicy.assertCanAccessAdminRoute(
      (request as Request & { user?: { id?: string; userId?: string } }).user,
      request.method,
    );
    return true;
  }

  private isAdminPath(request: Request): boolean {
    const path = request.originalUrl || request.url || '';
    const pathname = path.split('?')[0];
    return /(^|\/)admin(\/|$)/.test(pathname);
  }
}
