import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OWNERSHIP_KEY, OwnershipMetadata } from '../decorators/check-ownership.decorator';

@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<OwnershipMetadata | undefined>(OWNERSHIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!meta) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authenticatedUserId: string | undefined = request.user?.id;

    if (!authenticatedUserId) {
      throw new ForbiddenException('Authentication required');
    }

    const resourceId: string | undefined = request.params[meta.routeParam];
    if (!resourceId) {
      return true;
    }

    const repository = this.dataSource.getRepository(meta.entity as any);
    const resource = await repository.findOne({ where: { id: resourceId } as any });

    if (!resource) {
      throw new NotFoundException(`Resource ${resourceId} not found`);
    }

    if ((resource as any).userId !== authenticatedUserId) {
      throw new ForbiddenException('You do not have permission to access this resource');
    }

    return true;
  }
}
