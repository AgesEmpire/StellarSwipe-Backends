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
export class NigeriaSecFramework extends BaseComplianceFramework {
  readonly region = ComplianceRegion.NG;

  private readonly LARGE_TRANSACTION_NGN = 5_000_000;

  getRules(): ComplianceRule[] {
    return [
      {
        id: 'NSEC-001',
        name: 'BVN Verification Required',
        description: 'All users must provide and verify Bank Verification Number (BVN)',
        category: RuleCategory.KYC,
        severity: RuleSeverity.CRITICAL,
        region: ComplianceRegion.NG,
        isActive: true,
      },
      {
        id: 'NSEC-002',
        name: 'NIN Verification',
        description: 'National Identification Number required for all accounts',
        category: RuleCategory.KYC,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.NG,
        isActive: true,
      },
      {
        id: 'NSEC-003',
        name: 'SCUML Registration for Crypto',
        description: 'Digital asset service providers must register with SCUML',
        category: RuleCategory.REPORTING,
        severity: RuleSeverity.CRITICAL,
        region: ComplianceRegion.NG,
        isActive: true,
      },
      {
        id: 'NSEC-004',
        name: 'CBN Foreign Exchange Compliance',
        description: 'FX transactions must comply with CBN guidelines',
        category: RuleCategory.TRADING,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.NG,
        isActive: true,
      },
      {
        id: 'NSEC-005',
        name: 'Large Transaction Reporting',
        description: `Transactions over ₦${this.LARGE_TRANSACTION_NGN.toLocaleString()} must be reported to NFIU`,
        category: RuleCategory.AML,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.NG,
        isActive: true,
        metadata: { thresholdNGN: this.LARGE_TRANSACTION_NGN },
      },
      {
        id: 'NSEC-006',
        name: 'SEC Registration',
        description: 'Capital market operators must be SEC-registered',
        category: RuleCategory.REPORTING,
        severity: RuleSeverity.CRITICAL,
        region: ComplianceRegion.NG,
        isActive: true,
      },
    ];
  }

  getRequiredDocuments(): string[] {
    return [
      'bvn',
      'nin',
      'government_id',
      'proof_of_address_utility_bill',
      'tax_identification_number',
      'cac_certificate',
    ];
  }

  getDataRetentionPolicy(): { days: number; description: string } {
    return {
      days: 1825, // 5 years per NFIU guidelines
      description: 'Nigeria NFIU requires 5-year retention of transaction records',
    };
  }

  protected async evaluateRule(
    rule: ComplianceRule,
    context: ComplianceCheckContext,
  ): Promise<RuleViolationResult | null> {
    if (rule.id === 'NSEC-001' && !context.payload?.bvnVerified) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: 'BVN verification is required for Nigerian accounts',
        requiresAction: 'Complete BVN verification through NIBSS',
      };
    }

    if (rule.id === 'NSEC-005') {
      const amountNGN = context.payload?.amountNGN ?? 0;
      if (amountNGN > this.LARGE_TRANSACTION_NGN) {
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          message: `Transaction ₦${amountNGN.toLocaleString()} exceeds reporting threshold`,
          requiresAction: 'File Currency Transaction Report with NFIU',
        };
      }
    }

    return null;
  }
}
