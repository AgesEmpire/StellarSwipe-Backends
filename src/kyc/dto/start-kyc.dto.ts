import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  KycLevel,
  KycProvider,
  KycStatus,
} from '../entities/kyc-verification.entity';

// ─── Request DTOs ─────────────────────────────────────────────────────────

export class StartKycDto {
  @ApiProperty({
    enum: KycLevel,
    description: 'Target verification level (1 = Basic, 2 = Enhanced)',
    example: KycLevel.BASIC,
  })
  @IsEnum(KycLevel)
  targetLevel: KycLevel;

  @ApiPropertyOptional({
    enum: KycProvider,
    description: 'KYC provider to use (defaults to Persona)',
    default: KycProvider.PERSONA,
  })
  @IsOptional()
  @IsEnum(KycProvider)
  provider?: KycProvider;

  @ApiPropertyOptional({
    description: 'Redirect URL after Persona widget completion',
  })
  @IsOptional()
  @IsString()
  redirectUrl?: string;
}

export class WebhookVerifyDto {
  /** Persona or Onfido webhook payload — validated via signature */
  payload: Record<string, unknown>;
  signature: string;
  provider: KycProvider;
}

export class ManualReviewDto {
  @ApiProperty({ description: 'Admin user performing the review' })
  @IsUUID()
  reviewedBy: string;

  @ApiProperty({ enum: KycStatus, description: 'New status decision' })
  @IsEnum(KycStatus)
  status: KycStatus;

  @ApiPropertyOptional({ description: 'Reason for rejection or notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Response DTOs ────────────────────────────────────────────────────────

export class KycStatusDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ enum: KycLevel })
  level: KycLevel;

  @ApiProperty({ enum: KycStatus })
  status: KycStatus;

  @ApiProperty({ enum: KycProvider })
  provider: KycProvider;

  @ApiPropertyOptional()
  approvedAt?: Date;

  @ApiPropertyOptional()
  expiresAt?: Date;

  @ApiPropertyOptional()
  rejectionReason?: string;

  @ApiProperty()
  attemptCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class StartKycResponseDto {
  @ApiProperty({ description: 'Internal KYC verification record ID' })
  verificationRecordId: string;

  @ApiProperty({ description: 'Persona inquiry ID for widget initialisation' })
  inquiryId: string;

  @ApiProperty({ description: 'Session token to embed the Persona widget' })
  sessionToken: string;

  @ApiProperty({ description: 'Persona widget URL for redirect flow' })
  widgetUrl: string;
}

export class KycLimitDto {
  @ApiProperty({ enum: KycLevel })
  level: KycLevel;

  @ApiPropertyOptional({
    description: 'Monthly limit in USD. Null = unlimited.',
  })
  monthlyLimitUsd: number | null;

  @ApiProperty()
  currentMonthUsageUsd: number;

  @ApiPropertyOptional()
  remainingUsd: number | null;

  @ApiProperty()
  isLimitReached: boolean;
}

export class ComplianceReportDto {
  @ApiProperty()
  reportDate: Date;

  @ApiProperty()
  totalVerifications: number;

  @ApiProperty()
  approved: number;

  @ApiProperty()
  pending: number;

  @ApiProperty()
  rejected: number;

  @ApiProperty()
  expired: number;

  @ApiProperty()
  byLevel: Record<string, number>;

  @ApiProperty()
  byProvider: Record<string, number>;

  @ApiProperty()
  renewalsDue: number;
}
