import { ApiProperty } from '@nestjs/swagger';

export class ChannelPreferenceDto {
  @ApiProperty({ description: 'Email notifications enabled', example: true })
  email: boolean;

  @ApiProperty({ description: 'Push notifications enabled', example: true })
  push: boolean;
}

export class PreferenceDto {
  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ type: ChannelPreferenceDto })
  tradeUpdates: ChannelPreferenceDto;

  @ApiProperty({ type: ChannelPreferenceDto })
  signalPerformance: ChannelPreferenceDto;

  @ApiProperty({ type: ChannelPreferenceDto })
  systemAlerts: ChannelPreferenceDto;

  @ApiProperty({ type: ChannelPreferenceDto })
  marketing: ChannelPreferenceDto;

  @ApiProperty({ description: 'Last updated timestamp' })
  updatedAt: Date;
}
