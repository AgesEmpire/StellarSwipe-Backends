import { Global, Module } from '@nestjs/common';
import { BullCorrelationService } from './bull-correlation.service';
import { CorrelationModule } from '../correlation/correlation.module';
import { BullShutdownCoordinator } from './bull-shutdown.coordinator';

/**
 * Global module providing BullCorrelationService for propagating request
 * correlation IDs into BullMQ job payloads and processing.
 */
@Global()
@Module({
  imports: [CorrelationModule],
  providers: [BullCorrelationService, BullShutdownCoordinator],
  exports: [BullCorrelationService, BullShutdownCoordinator],
})
export class BullCorrelationModule {}
