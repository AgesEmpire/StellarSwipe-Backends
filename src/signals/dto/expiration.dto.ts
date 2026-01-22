import {
  IsUUID,
  IsEnum,
  IsInt,
  IsOptional,
  IsBoolean,
  IsString,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpirationAction } from '../entities/user-expiration-preference.entity';

export class UpdateExpirationPreferenceDto {
  @IsEnum(ExpirationAction)
  @IsOptional()
  defaultAction?: ExpirationAction;

  @IsInt()
  @Min(5)
  @Max(1440)
  @IsOptional()
  gracePeriodMinutes?: number;

  @IsInt()
  @Min(5)
  @Max(1440)
  @IsOptional()
  notifyBeforeExpirationMinutes?: number;

  @IsBoolean()
  @IsOptional()
  notifyOnAutoClose?: boolean;

  @IsBoolean()
  @IsOptional()
  notifyOnGracePeriodStart?: boolean;

  @IsNumber()
  @Min(-100)
  @Max(0)
  @IsOptional()
  autoCloseAtLossThreshold?: number;
}

export class QueueExpirationCheckDto {
  @IsUUID()
  signalId!: string;
}

export class SendWarningsDto {
  @IsInt()
  @Min(5)
  @Max(1440)
  @Type(() => Number)
  minutesBefore!: number;
}

export class CancelSignalDto {
  @IsUUID()
  signalId!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class MarkNotificationReadDto {
  @IsUUID()
  notificationId!: string;
}

export class GetNotificationsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  offset?: number = 0;
}
