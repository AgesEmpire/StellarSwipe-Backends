import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AlertSeverity } from './alert-rule.dto';

export enum NotificationChannel {
  EMAIL = 'email',
  SLACK = 'slack',
  SMS = 'sms',
  PAGERDUTY = 'pagerduty',
  WEBHOOK = 'webhook',
}

export class EscalationStepDto {
  @IsInt()
  @Min(1)
  level!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(NotificationChannel, { each: true })
  channels!: NotificationChannel[];

  @IsInt()
  @Min(0)
  delaySeconds = 0;
}

export class EscalationPolicyDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsEnum(AlertSeverity)
  minimumSeverity!: AlertSeverity;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => EscalationStepDto)
  steps!: EscalationStepDto[];

  @IsString()
  @IsOptional()
  ownerTeam?: string;
}
