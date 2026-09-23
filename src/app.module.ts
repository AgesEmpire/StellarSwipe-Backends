import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RequestContextModule } from './common/request-context/request-context.module';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';
import { TenantContextGuard } from './common/request-context/tenant-context.guard';

@Module({
  imports: [RequestContextModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: TenantContextGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
