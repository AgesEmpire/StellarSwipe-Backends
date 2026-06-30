import { Injectable, CanActivate, ExecutionContext, PayloadTooLargeException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const MAX_BODY_SIZE_KEY = 'max_body_size';

@Injectable()
export class MaxBodySizeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const limit = this.reflector.get<number>(MAX_BODY_SIZE_KEY, context.getHandler());
    if (!limit) return true;

    const request = context.switchToHttp().getRequest();
    const contentLength = parseInt(request.headers['content-length'] ?? '0', 10);

    if (contentLength > limit) {
      throw new PayloadTooLargeException(
        `Request body exceeds the per-endpoint limit of ${limit} bytes`,
      );
    }

    return true;
  }
}
