import { Injectable } from '@nestjs/common';
import { BaseComplianceFramework } from './base-framework';
import {
  ComplianceRegion,
  ComplianceRule,
  RuleCategory,
  RuleSeverity,
  ComplianceCheckContext,
  RuleViolationResult,
} from '../interfaces/compliance-framework.interface';

@Injectable()
export class UsFinraFramework extends BaseComplianceFramework {
  readonly region = ComplianceRegion.US;

  private readonly MAX_TRADE_VALUE_WITHOUT_REVIEW = 50000;

  getRules(): ComplianceRule[] {
    return [
      {
        id: 'FINRA-001',
        name: 'Customer Suitability',
        description: 'Investments must be suitable for customer risk profile',
        category: RuleCategory.TRADING,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.US,
        isActive: true,
      },
      {
        id: 'FINRA-002',
        name: 'Pattern Day Trader Rule',
        description: 'PDT accounts must maintain $25,000 minimum equity',
        category: RuleCategory.TRADING,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.US,
        isActive: true,
      },
      {
        id: 'FINRA-003',
        name: 'SAR Filing Requirement',
        description: 'Suspicious activity reports must be filed for transactions over $5,000',
        category: RuleCategory.AML,
        severity: RuleSeverity.CRITICAL,
        region: ComplianceRegion.US,
        isActive: true,
      },
      {
        id: 'FINRA-004',
        name: 'Accredited Investor Verification',
        description: 'Must verify accredited investor status for certain instruments',
        category: RuleCategory.KYC,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.US,
        isActive: true,
      },
      {
        id: 'FINRA-005',
        name: 'Best Execution',
        description: 'Orders must be executed at most favorable terms reasonably available',
        category: RuleCategory.TRADING,
        severity: RuleSeverity.MEDIUM,
        region: ComplianceRegion.US,
        isActive: true,
      },
      {
        id: 'FINRA-006',
        name: 'Large Trade Review',
        description: `Trades over $${this.MAX_TRADE_VALUE_WITHOUT_REVIEW} require compliance review`,
        category: RuleCategory.TRADING,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.US,
        isActive: true,
        metadata: { threshold: this.MAX_TRADE_VALUE_WITHOUT_REVIEW },
      },
    ];
  }

  getRequiredDocuments(): string[] {
    return [
      'ssn_or_itin',
      'government_id',
      'proof_of_address',
      'w9_form',
      'accredited_investor_certification',
    ];
  }

  getDataRetentionPolicy(): { days: number; description: string } {
    return {
      days: 2555, // 7 years per SEC Rule 17a-4
      description: 'FINRA/SEC requires 7-year retention for trading records',
    };
  }

  protected async evaluateRule(
    rule: ComplianceRule,
    context: ComplianceCheckContext,
  ): Promise<RuleViolationResult | null> {
    if (rule.id === 'FINRA-006') {
      const tradeValue = context.payload?.tradeValue ?? 0;
      if (tradeValue > this.MAX_TRADE_VALUE_WITHOUT_REVIEW) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Trade value $${tradeValue} exceeds $${this.MAX_TRADE_VALUE_WITHOUT_REVIEW} threshold`,
          requiresAction: 'Submit trade for compliance review before execution',
        };
      }
    }

    if (rule.id === 'FINRA-004' && context.payload?.requiresAccredited && !context.payload?.isAccredited) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: 'Accredited investor status not verified',
        requiresAction: 'Complete accredited investor verification',
      };
    }

    return null;
  }
}
