import { DropOffPointDto } from '../dto/conversion-report.dto';
import { StepAnalysisDto } from '../dto/funnel-analysis.dto';

export function analyzeDropOffs(steps: StepAnalysisDto[]): DropOffPointDto[] {
  return steps
    .map((step) => ({
      stepKey: step.stepKey,
      stepName: step.stepName,
      stepOrder: step.order,
      usersDropped: step.usersEntered - step.usersCompleted,
      dropOffRate: step.dropOffRate,
    }))
    .sort((a, b) => b.dropOffRate - a.dropOffRate);
}

export function findBiggestDropOff(dropOffs: DropOffPointDto[]): DropOffPointDto {
  return dropOffs[0];
}
