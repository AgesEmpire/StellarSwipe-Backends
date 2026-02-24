import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { SecurityAlert } from './entities/security-alert.entity';
import { SecurityIncident } from './entities/security-incident.entity';
import { SecurityMonitorService } from './monitoring/security-monitor.service';
import { AnomalyDetectorService } from './monitoring/anomaly-detector.service';
import { AlertManagerService } from './monitoring/alert-manager.service';
import { SecurityDashboardController } from './security-dashboard.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SecurityAlert, SecurityIncident]),
    EventEmitterModule,
  ],
  controllers: [SecurityDashboardController],
  providers: [
    SecurityMonitorService,
    AnomalyDetectorService,
    AlertManagerService,
  ],
  exports: [SecurityMonitorService],
})
export class SecurityMonitoringModule {}
