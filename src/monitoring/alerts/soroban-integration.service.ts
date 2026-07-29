import { Injectable, OnModuleInit } from '@nestjs/common';
import { SorobanService } from '../../soroban/soroban.service';
import { SorobanMonitoringService } from './soroban-monitoring.service';

@Injectable()
export class SorobanIntegrationService implements OnModuleInit {
  constructor(
    private readonly sorobanService: SorobanService,
    private readonly sorobanMonitoring: SorobanMonitoringService,
  ) {}

  onModuleInit() {
    // Inject monitoring service into Soroban service after module initialization
    (this.sorobanService as any).sorobanMonitoring = this.sorobanMonitoring;
  }
}