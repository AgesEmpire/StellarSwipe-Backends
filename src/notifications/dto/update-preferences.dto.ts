import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChannelPreferenceDto {
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferenceDto)
  tradeUpdates?: ChannelPreferenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferenceDto)
  signalPerformance?: ChannelPreferenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferenceDto)
  systemAlerts?: ChannelPreferenceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelPreferenceDto)
  marketing?: ChannelPreferenceDto;
}
