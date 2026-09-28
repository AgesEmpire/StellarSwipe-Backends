import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HttpRetryService } from './http-retry.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { PrometheusService } from '../monitoring/metrics/prometheus.service';
import { Registry } from 'prom-client';
import { defaultHttpModuleOptions } from './http-client-defaults';

/**
 * HttpRetryModule
 *
 * Provides HttpRetryService globally. Import this module in any feature
 * module that makes outbound third-party HTTP calls and needs safe
 * exponential-backoff retry behaviour.
 *
 * Example:
 *   @Module({ imports: [HttpRetryModule] })
 *   export class PricesModule {}
 */
@Module({
  imports: [
    HttpModule.register(defaultHttpModuleOptions()),
    MonitoringModule,
  ],
  providers: [
    HttpRetryService,
    {
      provide: CircuitBreakerService,
      useFactory: (prometheus: PrometheusService) =>
        new CircuitBreakerService(prometheus.registry),
      inject: [PrometheusService],
    },
  ],
  exports: [HttpRetryService, CircuitBreakerService],
})
export class HttpRetryModule {}
