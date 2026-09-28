import { Controller, Delete, Get, Header, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrometheusService } from './metrics/prometheus.service';
import { CircuitBreakerService } from '../http/circuit-breaker.service';
import { HealthMetricsAuthGuard } from '../common/guards/health-metrics-auth.guard';

@ApiTags('monitoring')
@Controller('metrics')
@UseGuards(HealthMetricsAuthGuard)
export class MonitoringController {
  constructor(
    private readonly prometheus: PrometheusService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  /**
   * Prometheus scrape endpoint.
   * Returns all registered metrics in the Prometheus text exposition format.
   * Includes: HTTP timings, error rates, Bull queue sizes, cache stats, DB pool,
   * and business counters — all labelled by endpoint and service type.
   */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics scrape endpoint' })
  async getMetrics(): Promise<string> {
    return this.prometheus.getMetrics();
  }

  @Get('circuit-breakers')
  @ApiOperation({ summary: 'Get current state of all circuit breakers' })
  @ApiResponse({
    status: 200,
    description: 'Map of circuit name → state, failures, successes, timestamps',
  })
  getCircuitBreakers(): Record<string, unknown> {
    return this.circuitBreaker.getAllStats();
  }

  @Delete('circuit-breakers/:name')
  @ApiOperation({ summary: 'Manually reset a named circuit breaker to CLOSED' })
  @ApiParam({ name: 'name', description: 'Circuit breaker name (e.g. stellar-horizon)' })
  @ApiResponse({ status: 200, description: 'Circuit reset successfully' })
  resetCircuitBreaker(@Param('name') name: string): { reset: boolean; circuit: string } {
    this.circuitBreaker.reset(name);
    return { reset: true, circuit: name };
  }
}
