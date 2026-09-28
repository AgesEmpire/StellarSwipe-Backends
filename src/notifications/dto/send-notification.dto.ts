import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannel } from '../entities/notification.entity';

export class SendNotificationDto {
  @ApiProperty({ description: 'Target user ID' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ description: 'Notification type, e.g. TRADE_EXECUTED' })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ description: 'Notification message body' })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({ enum: NotificationChannel, default: NotificationChannel.IN_APP })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
