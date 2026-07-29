import { Injectable } from '@nestjs/common';
import {
  ComplianceRule,
  ComplianceCheckContext,
  RuleSeverity,
} from '../interfaces/compliance-framework.interface';

@Injectable()
export class RuleEngine {
  filterBySeverity(rules: ComplianceRule[], minSeverity: RuleSeverity): ComplianceRule[] {
    const order = [RuleSeverity.LOW, RuleSeverity.MEDIUM, RuleSeverity.HIGH, RuleSeverity.CRITICAL];
    const minIndex = order.indexOf(minSeverity);
    return rules.filter((r) => order.indexOf(r.severity) >= minIndex);
  }

  filterByAction(rules: ComplianceRule[], action: string): ComplianceRule[] {
    return rules.filter(
      (r) => !r.metadata?.applicableActions || r.metadata.applicableActions.includes(action),
    );
  }

  prioritize(rules: ComplianceRule[]): ComplianceRule[] {
    const order = [RuleSeverity.CRITICAL, RuleSeverity.HIGH, RuleSeverity.MEDIUM, RuleSeverity.LOW];
    return [...rules].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  }

  hasBlockingViolations(
    violations: Array<{ severity: RuleSeverity }>,
    blockOn: RuleSeverity[] = [RuleSeverity.CRITICAL, RuleSeverity.HIGH],
  ): boolean {
    return violations.some((v) => blockOn.includes(v.severity));
  }
}
