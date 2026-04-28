import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const UserTimezone = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ userTimezone?: string }>();
    return request.userTimezone ?? 'UTC';
  },
);
