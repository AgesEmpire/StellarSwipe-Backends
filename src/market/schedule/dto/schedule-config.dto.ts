import { IsString, IsEnum, Matches, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { DayOfWeek } from '../entities/market-schedule.entity';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateScheduleConfigDto {
  @IsString()
  @MaxLength(50)
  region!: string;

  @IsString()
  @MaxLength(20)
  assetClass!: string;

  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @Matches(TIME_PATTERN, { message: 'openTime must be in HH:MM format' })
  openTime!: string;

  @Matches(TIME_PATTERN, { message: 'closeTime must be in HH:MM format' })
  closeTime!: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

export class UpdateScheduleConfigDto {
  @IsOptional()
  @Matches(TIME_PATTERN)
  openTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN)
  closeTime?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
