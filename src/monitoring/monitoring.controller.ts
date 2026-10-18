import { Controller, Delete, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
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

  /**
   * #1375 — Manual recovery control. Who may call this is governed entirely
   * by `HealthMetricsAuthGuard` on the controller (JWT user or admin-style
   * API key); this handler's only job is to attribute the action in the
   * audit trail so every manual override is traceable to its caller.
   */
  @Delete('circuit-breakers/:name')
  @ApiOperation({ summary: 'Manually reset a named circuit breaker to CLOSED (audited)' })
  @ApiParam({ name: 'name', description: 'Circuit breaker name (e.g. stellar-horizon)' })
  @ApiResponse({ status: 200, description: 'Circuit reset successfully' })
  resetCircuitBreaker(
    @Param('name') name: string,
    @Req() req: any,
  ): { reset: boolean; circuit: string } {
    const actor = req.user?.id ?? req.user?.email ?? req.apiKey?.id ?? 'unknown';
    this.circuitBreaker.reset(name, actor);
    return { reset: true, circuit: name };
  }

  /** #1375 — Audit trail of manual circuit breaker resets. */
  @Get('circuit-breakers/audit-log')
  @ApiOperation({ summary: 'List the audit trail of manual circuit breaker resets' })
  getCircuitBreakerAuditLog() {
    return this.circuitBreaker.getAuditLog();
  }
}
