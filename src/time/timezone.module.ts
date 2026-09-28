import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { TimezoneService } from './timezone.service';
import { TimezoneConverter } from './utils/timezone-converter';
import { TradingHoursCalculator } from './utils/trading-hours-calculator';
import { MarketHoursDetector } from './utils/market-hours-detector';
import { TimezoneResolverMiddleware } from './middleware/timezone-resolver.middleware';
import { TimezoneController } from './timezone.controller';

@Module({
  providers: [TimezoneService, TimezoneConverter, TradingHoursCalculator, MarketHoursDetector, TimezoneResolverMiddleware],
  controllers: [TimezoneController],
  exports: [TimezoneService, TimezoneConverter, TradingHoursCalculator, MarketHoursDetector],
})
export class TimezoneModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TimezoneResolverMiddleware).forRoutes('*');
  }
}
