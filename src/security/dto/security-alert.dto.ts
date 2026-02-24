import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsObject,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertSeverity, AlertType } from '../entities/security-alert.entity';

export class CreateSecurityAlertDto {
  @ApiProperty({ description: 'User ID associated with the alert' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: AlertType, description: 'Type of security alert' })
  @IsEnum(AlertType)
  type: AlertType;

  @ApiProperty({ enum: AlertSeverity, description: 'Severity level' })
  @IsEnum(AlertSeverity)
  severity: AlertSeverity;

  @ApiPropertyOptional({ description: 'Additional alert details' })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}

export class ResolveAlertDto {
  @ApiProperty({ description: 'Admin user ID resolving the alert' })
  @IsUUID()
  resolvedBy: string;

  @ApiPropertyOptional({ description: 'Resolution note' })
  @IsOptional()
  @IsString()
  resolutionNote?: string;

  @ApiPropertyOptional({ description: 'Mark as false positive' })
  @IsOptional()
  @IsBoolean()
  falsePositive?: boolean;
}

export class SecurityAlertResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ enum: AlertType })
  type: AlertType;

  @ApiProperty({ enum: AlertSeverity })
  severity: AlertSeverity;

  @ApiProperty()
  details: Record<string, unknown>;

  @ApiProperty()
  resolved: boolean;

  @ApiPropertyOptional()
  resolvedBy?: string;

  @ApiPropertyOptional()
  resolvedAt?: Date;

  @ApiPropertyOptional()
  resolutionNote?: string;

  @ApiProperty()
  notificationSent: boolean;

  @ApiProperty()
  falsePositive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class SecurityDashboardDto {
  @ApiProperty()
  totalAlerts: number;

  @ApiProperty()
  unresolvedAlerts: number;

  @ApiProperty()
  criticalAlerts: number;

  @ApiProperty()
  lockedAccounts: number;

  @ApiProperty()
  openIncidents: number;

  @ApiProperty()
  alertsByType: Record<string, number>;

  @ApiProperty()
  alertsBySeverity: Record<string, number>;

  @ApiProperty()
  recentAlerts: SecurityAlertResponseDto[];

  @ApiProperty()
  alertTrend: { date: string; count: number }[];
}

export class SecurityAlertQueryDto {
  @ApiPropertyOptional({ enum: AlertSeverity })
  @IsOptional()
  @IsEnum(AlertSeverity)
  severity?: AlertSeverity;

  @ApiPropertyOptional({ enum: AlertType })
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  resolved?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number;
}
