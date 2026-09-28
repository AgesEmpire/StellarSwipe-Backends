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
export class EuGdprFramework extends BaseComplianceFramework {
  readonly region = ComplianceRegion.EU;

  getRules(): ComplianceRule[] {
    return [
      {
        id: 'GDPR-001',
        name: 'Explicit Consent Required',
        description: 'Users must provide explicit consent for data processing',
        category: RuleCategory.DATA_PRIVACY,
        severity: RuleSeverity.CRITICAL,
        region: ComplianceRegion.EU,
        isActive: true,
      },
      {
        id: 'GDPR-002',
        name: 'Right to Erasure',
        description: 'Users can request deletion of their personal data',
        category: RuleCategory.DATA_PRIVACY,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.EU,
        isActive: true,
      },
      {
        id: 'GDPR-003',
        name: 'Data Portability',
        description: 'Users can export their data in machine-readable format',
        category: RuleCategory.DATA_PRIVACY,
        severity: RuleSeverity.MEDIUM,
        region: ComplianceRegion.EU,
        isActive: true,
      },
      {
        id: 'GDPR-004',
        name: 'Data Breach Notification 72h',
        description: 'Data breaches must be reported to authorities within 72 hours',
        category: RuleCategory.REPORTING,
        severity: RuleSeverity.CRITICAL,
        region: ComplianceRegion.EU,
        isActive: true,
      },
      {
        id: 'GDPR-005',
        name: 'KYC with AMLD5',
        description: 'KYC must comply with EU 5th Anti-Money Laundering Directive',
        category: RuleCategory.KYC,
        severity: RuleSeverity.HIGH,
        region: ComplianceRegion.EU,
        isActive: true,
      },
    ];
  }

  getRequiredDocuments(): string[] {
    return [
      'government_id',
      'proof_of_address',
      'tax_identification_number',
      'gdpr_consent_form',
    ];
  }

  getDataRetentionPolicy(): { days: number; description: string } {
    return {
      days: 1825, // 5 years
      description: 'EU GDPR requires data retention for 5 years with right to erasure',
    };
  }

  protected async evaluateRule(
    rule: ComplianceRule,
    context: ComplianceCheckContext,
  ): Promise<RuleViolationResult | null> {
    if (rule.id === 'GDPR-001' && context.payload?.hasConsent === false) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: 'User has not provided explicit GDPR consent',
        requiresAction: 'Obtain explicit user consent before processing data',
      };
    }
    return null;
  }
}
