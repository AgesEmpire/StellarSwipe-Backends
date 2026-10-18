import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpRetryService } from './http-retry.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { CircuitBreakerController } from './circuit-breaker.controller';
import { ProviderConcurrencyService } from './provider-concurrency.service';
import { RetryBudgetService } from './retry-budget.service';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { PrometheusService } from '../monitoring/metrics/prometheus.service';
import { Registry } from 'prom-client';
import { defaultHttpModuleOptions } from './http-client-defaults';
import { UserRole } from '../authorization/entities/user-role.entity';

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
    // Needed by AdminRoleGuard on CircuitBreakerController's admin endpoints.
    TypeOrmModule.forFeature([UserRole]),
  ],
  controllers: [CircuitBreakerController],
  providers: [
    HttpRetryService,
    ProviderConcurrencyService,
    RetryBudgetService,
    {
      provide: CircuitBreakerService,
      useFactory: (prometheus: PrometheusService) =>
        new CircuitBreakerService(prometheus.registry),
      inject: [PrometheusService],
    },
  ],
  exports: [
    HttpRetryService,
    CircuitBreakerService,
    ProviderConcurrencyService,
    RetryBudgetService,
  ],
})
export class HttpRetryModule {}
