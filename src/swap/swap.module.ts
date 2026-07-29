import { Module } from '@nestjs/common';
import { RouteOptimizerService } from './routing/route-optimizer.service';
import { RouteController } from './routing/route.controller';

@Module({
  controllers: [RouteController],
  providers: [RouteOptimizerService],
  exports: [RouteOptimizerService],
})
export class SwapModule {}
