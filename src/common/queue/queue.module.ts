import { Module } from '@nestjs/common';
import { StuckJobDetectorService } from './stuck-job-detector.service';

/**
 * QueueModule
 *
 * Provides utilities for managing BullMQ queues, including:
 * - StuckJobDetectorService: Monitors for jobs exceeding max processing duration
 */
@Module({
  providers: [StuckJobDetectorService],
  exports: [StuckJobDetectorService],
})
export class QueueModule {}
