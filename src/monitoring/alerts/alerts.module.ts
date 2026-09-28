import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SorobanMonitoringService } from './soroban-monitoring.service';
import { AlertNotificationService } from './alert-notification.service';
import { SorobanIntegrationService } from './soroban-integration.service';
import { SorobanModule } from '../../soroban/soroban.module';

@Module({
  imports: [EventEmitterModule, SorobanModule],
  providers: [SorobanMonitoringService, AlertNotificationService, SorobanIntegrationService],
  exports: [SorobanMonitoringService, AlertNotificationService],
})
export class AlertsModule {}