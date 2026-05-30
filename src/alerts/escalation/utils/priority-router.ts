import { AlertSeverity } from '../dto/alert-rule.dto';
import {
  EscalationPolicyDto,
  EscalationStepDto,
  NotificationChannel,
} from '../dto/escalation-policy.dto';

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  [AlertSeverity.LOW]: 1,
  [AlertSeverity.MEDIUM]: 2,
  [AlertSeverity.HIGH]: 3,
  [AlertSeverity.CRITICAL]: 4,
};

const DEFAULT_STEPS: Record<AlertSeverity, EscalationStepDto[]> = {
  [AlertSeverity.LOW]: [
    { level: 1, channels: [NotificationChannel.EMAIL], delaySeconds: 0 },
  ],
  [AlertSeverity.MEDIUM]: [
    { level: 1, channels: [NotificationChannel.SLACK], delaySeconds: 0 },
  ],
  [AlertSeverity.HIGH]: [
    { level: 1, channels: [NotificationChannel.SLACK], delaySeconds: 0 },
    { level: 2, channels: [NotificationChannel.EMAIL], delaySeconds: 300 },
  ],
  [AlertSeverity.CRITICAL]: [
    { level: 1, channels: [NotificationChannel.PAGERDUTY], delaySeconds: 0 },
    { level: 2, channels: [NotificationChannel.SMS], delaySeconds: 60 },
    { level: 3, channels: [NotificationChannel.SLACK, NotificationChannel.EMAIL], delaySeconds: 120 },
  ],
};

export interface RoutedEscalation {
  escalationLevel: number;
  steps: EscalationStepDto[];
}

export function routeByPriority(
  severity: AlertSeverity,
  policy?: EscalationPolicyDto,
): RoutedEscalation {
  const policyApplies =
    policy && SEVERITY_RANK[severity] >= SEVERITY_RANK[policy.minimumSeverity];
  const steps = policyApplies ? policy.steps : DEFAULT_STEPS[severity];
  const sortedSteps = [...steps].sort((a, b) => a.level - b.level);

  return {
    escalationLevel: sortedSteps[sortedSteps.length - 1]?.level ?? 1,
    steps: sortedSteps,
  };
}
