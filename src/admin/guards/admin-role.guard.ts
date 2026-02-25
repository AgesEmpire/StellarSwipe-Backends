import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class AdminRoleGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        // Assuming user object from JWT is populated via JwtAuthGuard before this guard is called
        if (!user) {
            throw new ForbiddenException('User authentication required for admin access');
        }

        // Usually there is user.role or user.isAdmin depending on implementation
        if (user.role !== 'ADMIN' && user.isAdmin !== true) {
            throw new ForbiddenException('Administrative privileges required');
        }

        return true;
    }
}
