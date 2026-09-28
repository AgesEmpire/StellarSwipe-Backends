import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VersionManagerService } from './version-manager.service';
import { VersionResolverMiddleware } from './middleware/version-resolver.middleware';
import { DeprecationInterceptor } from './interceptors/deprecation.interceptor';
import { VersionCompatibilityGuard } from './guards/version-compatibility.guard';

@Module({
  providers: [VersionManagerService, DeprecationInterceptor, VersionCompatibilityGuard, Reflector],
  exports: [VersionManagerService, DeprecationInterceptor, VersionCompatibilityGuard],
})
export class VersioningModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(VersionResolverMiddleware)
      .forRoutes('*');
  }
}
