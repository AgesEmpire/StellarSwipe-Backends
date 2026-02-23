import { IsUUID, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AchievementRarity } from '../entities/achievement.entity';

// ─── Response DTOs ──────────────────────────────────────────────────────────

export class AchievementDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiPropertyOptional()
  badgeImage?: string;

  @ApiProperty({ enum: ['common', 'rare', 'epic', 'legendary'] })
  rarity: AchievementRarity;
}

export class UserAchievementDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  achievement: AchievementDto;

  @ApiProperty({ description: 'Progress percentage (0-100), null when awarded' })
  progress: number | null;

  @ApiPropertyOptional()
  awardedAt?: Date;

  @ApiProperty()
  isAwarded: boolean;
}

export class UserAchievementsResponseDto {
  @ApiProperty()
  userId: string;

  @ApiProperty({ type: [UserAchievementDto] })
  awarded: UserAchievementDto[];

  @ApiProperty({ type: [UserAchievementDto] })
  inProgress: UserAchievementDto[];

  @ApiProperty()
  totalAwarded: number;
}

// ─── Query DTOs ──────────────────────────────────────────────────────────────

export class GetUserAchievementsQueryDto {
  @ApiPropertyOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter only awarded badges' })
  @IsOptional()
  @IsBoolean()
  awardedOnly?: boolean;
}

// ─── Internal event payloads (not HTTP DTOs but kept here for colocation) ───

export interface TradeExecutedPayload {
  userId: string;
  tradeId: string;
  profit: number;        // positive = win, negative = loss
  holdDays?: number;     // how long position was held
}

export interface SignalCreatedPayload {
  userId: string;
  signalId: string;
}

export interface SignalCopiedPayload {
  providerId: string;
  signalId: string;
  totalCopies: number;
}
