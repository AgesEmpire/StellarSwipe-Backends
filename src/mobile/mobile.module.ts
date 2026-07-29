import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { MobileApiController } from './mobile-api.controller';
import { MobileApiService } from './mobile-api.service';
import { PayloadOptimizerService } from './services/payload-optimizer.service';
import { DeltaSyncService } from './services/delta-sync.service';
import { PushTokenManagerService } from './services/push-token-manager.service';
import { MobileOptimizationMiddleware } from './middleware/mobile-optimization.middleware';

@Module({
  controllers: [MobileApiController],
  providers: [
    MobileApiService,
    PayloadOptimizerService,
    DeltaSyncService,
    PushTokenManagerService,
  ],
  exports: [MobileApiService],
})
export class MobileModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MobileOptimizationMiddleware).forRoutes(MobileApiController);
  }
}
