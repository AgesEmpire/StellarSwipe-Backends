export enum ComplianceRegion {
  EU = 'EU',
  US = 'US',
  NG = 'NG',
  GLOBAL = 'GLOBAL',
}

export enum RuleSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum RuleCategory {
  DATA_PRIVACY = 'data_privacy',
  KYC = 'kyc',
  REPORTING = 'reporting',
  TRADING = 'trading',
  AML = 'aml',
}

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  severity: RuleSeverity;
  region: ComplianceRegion;
  isActive: boolean;
  metadata?: Record<string, any>;
}

export interface ComplianceCheckContext {
  userId: string;
  region: ComplianceRegion;
  action: string;
  payload?: Record<string, any>;
  ipAddress?: string;
}

export interface ComplianceCheckResult {
  passed: boolean;
  region: ComplianceRegion;
  checkedRules: string[];
  violations: RuleViolationResult[];
  timestamp: Date;
}

export interface RuleViolationResult {
  ruleId: string;
  ruleName: string;
  severity: RuleSeverity;
  message: string;
  requiresAction?: string;
}

export interface IComplianceFramework {
  region: ComplianceRegion;
  getRules(): ComplianceRule[];
  check(context: ComplianceCheckContext): Promise<ComplianceCheckResult>;
  getRequiredDocuments(): string[];
  getDataRetentionPolicy(): { days: number; description: string };
}
