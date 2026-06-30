import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrometheusService } from './metrics/prometheus.service';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { PayloadSizeInterceptor } from './metrics/payload-size.interceptor';
import { QueueMetricsService } from './metrics/queue-metrics.service';
import { MetricsDashboardService } from './metrics/metrics-dashboard.service';
import { MonitoringController } from './monitoring.controller';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CircuitBreakerService } from '../http/circuit-breaker.service';
import { CanaryTradeService } from './canary-trade.service';

@Global()
@Module({
  imports: [AuthModule, ApiKeysModule],
  providers: [
    PrometheusService,
    MetricsInterceptor,
    PayloadSizeInterceptor,
    CanaryTradeService,
    {
      provide: CircuitBreakerService,
      useFactory: (prometheus: PrometheusService) =>
        new CircuitBreakerService(prometheus.registry),
      inject: [PrometheusService],
    },
  ],
  controllers: [MonitoringController],
  exports: [PrometheusService, MetricsInterceptor, PayloadSizeInterceptor, CircuitBreakerService],
})
export class MonitoringModule {}
