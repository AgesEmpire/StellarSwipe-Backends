import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { ProductAnalyticsService } from './product-analytics.service';
import { ProductAnalyticsController } from './product-analytics.controller';
import { MixpanelProvider } from './providers/mixpanel.provider';
import { AmplitudeProvider } from './providers/amplitude.provider';
import { AnalyticsInterceptor } from './interceptors/analytics.interceptor';

/**
 * Global module so ProductAnalyticsService can be injected anywhere
 * without importing this module in every feature module.
 */
@Global()
@Module({
  imports: [ConfigModule, EventEmitterModule],
  controllers: [ProductAnalyticsController],
  providers: [
    ProductAnalyticsService,
    MixpanelProvider,
    AmplitudeProvider,
    AnalyticsInterceptor,
  ],
  exports: [ProductAnalyticsService, AnalyticsInterceptor],
})
export class ProductAnalyticsModule {}
