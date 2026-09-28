import { ComplianceRegion } from '../interfaces/compliance-framework.interface';

export class ComplianceStatusDto {
  userId!: string;
  region!: ComplianceRegion;
  passed!: boolean;
  checkedRules!: string[];
  violationCount!: number;
  lastCheckedAt!: Date;
}
