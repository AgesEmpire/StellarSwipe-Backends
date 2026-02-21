import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { VersionDetectionMiddleware } from '../middleware/version-detection.middleware';
import { DeprecationMiddleware } from '../middleware/deprecation.middleware';

@Module({})
export class VersioningModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(VersionDetectionMiddleware, DeprecationMiddleware)
      .forRoutes('*');
  }
}
