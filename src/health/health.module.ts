import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import {
  StellarHealthIndicator,
  SorobanHealthIndicator,
  DatabaseHealthIndicator,
  RedisHealthIndicator,
} from './indicators';
import { StellarConfigService } from '../config/stellar.service';
import { HealthSummaryService } from './health-summary.service';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { MonitoringModule } from '../monitoring/monitoring.module';

@Module({
  imports: [TerminusModule, MonitoringModule],
  controllers: [HealthController],
  providers: [
    StellarConfigService,
    StellarHealthIndicator,
    SorobanHealthIndicator,
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    HealthSummaryService,
  ],
  exports: [
    StellarHealthIndicator,
    SorobanHealthIndicator,
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    HealthSummaryService,
  ],
})
export class HealthModule {}
