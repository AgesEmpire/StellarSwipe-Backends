import {
  IsEmail,
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsUUID,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FeedbackType } from '../entities/feedback.entity';

// Invite Code DTOs
export class CreateInviteCodeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxUses?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class ValidateInviteCodeDto {
  @IsString()
  @MaxLength(16)
  code!: string;
}

export class GenerateBulkInviteCodesDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  count!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxUsesPerCode?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

// Beta User DTOs
export class RegisterBetaUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(16)
  inviteCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(56)
  stellarAddress?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateBetaUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(56)
  stellarAddress?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

// Waitlist DTOs
export class JoinWaitlistDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  referralCode?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class InviteFromWaitlistDto {
  @IsUUID()
  waitlistId!: string;
}

export class BulkInviteFromWaitlistDto {
  @IsInt()
  @Min(1)
  @Max(100)
  count!: number;
}

// Feedback DTOs
export class CreateFeedbackDto {
  @IsEnum(FeedbackType)
  type!: FeedbackType;

  @IsString()
  @MaxLength(255)
  title!: string;

  @IsString()
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

// Query DTOs
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

// Response interfaces (not DTOs, just type definitions)
export interface InviteCodeResponse {
  id: string;
  code: string;
  status: string;
  maxUses: number;
  currentUses: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface BetaUserResponse {
  id: string;
  email: string;
  stellarAddress: string | null;
  status: string;
  referralCount: number;
  activatedAt: Date | null;
  createdAt: Date;
}

export interface WaitlistResponse {
  id: string;
  email: string;
  status: string;
  position: number;
  referralCode: string | null;
  referralCount: number;
  createdAt: Date;
}

export interface WaitlistStatsDto {
  totalWaiting: number;
  totalInvited: number;
  totalJoined: number;
}

export interface BetaStatsDto {
  totalBetaUsers: number;
  activeBetaUsers: number;
  totalInviteCodes: number;
  activeInviteCodes: number;
  totalWaitlist: number;
  totalFeedback: number;
}
