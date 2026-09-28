import {
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { UserEventType } from '../entities/user-event.entity';

export class TrackBehaviorEventDto {
  @IsEnum(UserEventType)
  eventType!: UserEventType;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class StartSessionDto {
  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class EndSessionDto {
  @IsString()
  sessionId!: string;
}

export class UpdateTrackingConsentDto {
  @IsBoolean()
  analyticsOptIn!: boolean;
}
