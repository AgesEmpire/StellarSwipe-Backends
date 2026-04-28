import { RuleSeverity } from '../interfaces/compliance-framework.interface';

export class RuleViolationDto {
  ruleId!: string;
  ruleName!: string;
  severity!: RuleSeverity;
  message!: string;
  requiresAction?: string;
}
