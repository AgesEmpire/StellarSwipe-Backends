import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { PrometheusService } from './metrics/prometheus.service';
import { HealthMetricsAuthGuard } from '../common/guards/health-metrics-auth.guard';

@Controller('metrics')
@UseGuards(HealthMetricsAuthGuard)
export class MonitoringController {
  constructor(private readonly prometheus: PrometheusService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.prometheus.getMetrics();
  }
}
