import {
  IComplianceFramework,
  ComplianceRegion,
  ComplianceRule,
  ComplianceCheckContext,
  ComplianceCheckResult,
  RuleViolationResult,
} from '../interfaces/compliance-framework.interface';

export abstract class BaseComplianceFramework implements IComplianceFramework {
  abstract readonly region: ComplianceRegion;

  abstract getRules(): ComplianceRule[];
  abstract getRequiredDocuments(): string[];
  abstract getDataRetentionPolicy(): { days: number; description: string };

  async check(context: ComplianceCheckContext): Promise<ComplianceCheckResult> {
    const rules = this.getRules().filter((r) => r.isActive);
    const violations: RuleViolationResult[] = [];

    for (const rule of rules) {
      const violation = await this.evaluateRule(rule, context);
      if (violation) violations.push(violation);
    }

    return {
      passed: violations.length === 0,
      region: this.region,
      checkedRules: rules.map((r) => r.id),
      violations,
      timestamp: new Date(),
    };
  }

  protected async evaluateRule(
    rule: ComplianceRule,
    context: ComplianceCheckContext,
  ): Promise<RuleViolationResult | null> {
    return null;
  }
}
