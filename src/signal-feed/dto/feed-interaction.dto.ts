import { IsEnum, IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SwipeDirection {
  RIGHT = 'right',
  LEFT = 'left',
}

export enum FeedInteractionType {
  SWIPE_IMPRESSION = 'SWIPE_IMPRESSION',
  SWIPE_RIGHT = 'SWIPE_RIGHT',
  SWIPE_LEFT = 'SWIPE_LEFT',
  CARD_DETAIL_OPEN = 'CARD_DETAIL_OPEN',
  FEED_VIEW = 'FEED_VIEW',
}

export class FeedInteractionDto {
  @ApiProperty({ enum: FeedInteractionType })
  @IsEnum(FeedInteractionType)
  type!: FeedInteractionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  signalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerId?: string;

  @ApiPropertyOptional({ description: 'Device type: ios | android | web' })
  @IsOptional()
  @IsString()
  device?: string;

  @ApiPropertyOptional({ description: 'User cohort identifier' })
  @IsOptional()
  @IsString()
  cohort?: string;

  @ApiPropertyOptional({ description: 'Feed context: e.g. filter applied, sort order' })
  @IsOptional()
  @IsString()
  feedContext?: string;

  @ApiPropertyOptional({ description: 'Client-generated idempotency key' })
  @IsOptional()
  @IsString()
  eventId?: string;
}
