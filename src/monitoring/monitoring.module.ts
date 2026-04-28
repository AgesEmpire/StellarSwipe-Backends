import { Module, Global } from '@nestjs/common';
import { PrometheusService } from './metrics/prometheus.service';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { MonitoringController } from './monitoring.controller';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Global()
@Module({
  imports: [AuthModule, ApiKeysModule],
  providers: [PrometheusService, MetricsInterceptor],
  controllers: [MonitoringController],
  exports: [PrometheusService, MetricsInterceptor],
})
export class MonitoringModule {}
