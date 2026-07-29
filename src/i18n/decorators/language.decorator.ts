import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const Language = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return (request as any).language || 'en';
  },
);
