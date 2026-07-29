import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ChannelUpdateDto {
  @ApiPropertyOptional({ description: 'Enable or disable email notifications' })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({ description: 'Enable or disable push notifications' })
  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ type: ChannelUpdateDto, description: 'Trade update notification settings' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelUpdateDto)
  tradeUpdates?: ChannelUpdateDto;

  @ApiPropertyOptional({ type: ChannelUpdateDto, description: 'Signal performance notification settings' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelUpdateDto)
  signalPerformance?: ChannelUpdateDto;

  @ApiPropertyOptional({ type: ChannelUpdateDto, description: 'System alert notification settings' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelUpdateDto)
  systemAlerts?: ChannelUpdateDto;

  @ApiPropertyOptional({ type: ChannelUpdateDto, description: 'Marketing notification settings' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelUpdateDto)
  marketing?: ChannelUpdateDto;
}
