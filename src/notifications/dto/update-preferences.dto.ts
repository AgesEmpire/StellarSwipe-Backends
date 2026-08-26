import {
  IsBoolean,
  IsOptional,
  IsNumber,
  Min,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const TIME_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ChannelPreferenceDto {
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

export class QuietHoursDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Matches(TIME_HHMM, { message: 'start must be in HH:mm format' })
  start?: string;

  @IsOptional()
  @Matches(TIME_HHMM, { message: 'end must be in HH:mm format' })
  end?: string;

  @IsOptional()
  timezone?: string;
}

export class ThresholdsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  tradeUpdates?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  signalPerformance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  systemAlerts?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  marketing?: number;
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

  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ThresholdsDto)
  thresholds?: ThresholdsDto;
}
