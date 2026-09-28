import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsArray,
  IsDateString,
  IsObject,
} from 'class-validator';
import { RegionCode } from '../entities/data-region.entity';
import { PolicyType } from '../entities/residency-policy.entity';

export enum ComplianceStatus {
  COMPLIANT = 'compliant',
  NON_COMPLIANT = 'non_compliant',
  PENDING_REVIEW = 'pending_review',
  EXEMPT = 'exempt',
}

export class ComplianceCheckDto {
  @IsString()
  userId: string;

  @IsEnum(RegionCode)
  region: RegionCode;

  @IsEnum(PolicyType)
  @IsOptional()
  policyType?: PolicyType;

  @IsString()
  @IsOptional()
  countryCode?: string;
}

export class ComplianceResultDto {
  @IsString()
  userId: string;

  @IsEnum(RegionCode)
  region: RegionCode;

  @IsEnum(ComplianceStatus)
  status: ComplianceStatus;

  @IsArray()
  applicableFrameworks: string[];

  @IsBoolean()
  dataLocalized: boolean;

  @IsBoolean()
  encryptionEnabled: boolean;

  @IsArray()
  violations: ComplianceViolationDto[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ComplianceViolationDto {
  @IsString()
  code: string;

  @IsString()
  description: string;

  @IsString()
  severity: 'critical' | 'high' | 'medium' | 'low';

  @IsString()
  @IsOptional()
  remediationAction?: string;
}

export class ComplianceReportDto {
  @IsDateString()
  generatedAt: string;

  @IsEnum(RegionCode)
  region: RegionCode;

  @IsArray()
  frameworks: string[];

  @IsString()
  overallStatus: ComplianceStatus;

  @IsArray()
  userResults: ComplianceResultDto[];

  @IsObject()
  summary: {
    totalUsers: number;
    compliant: number;
    nonCompliant: number;
    pendingReview: number;
  };
}
