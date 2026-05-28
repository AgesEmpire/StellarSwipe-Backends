import { Module } from '@nestjs/common';

import { DriftDetectorService } from './drift-detector.service';
import { DetectDataDriftJob } from './jobs/detect-data-drift.job';

@Module({
  providers: [DriftDetectorService, DetectDataDriftJob],
  exports: [DriftDetectorService],
})
export class DriftDetectionModule {}
