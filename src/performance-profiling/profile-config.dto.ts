import {
  IsEnum,
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsObject,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ProfileSessionType } from '../entities/profile-session.entity';

export class ProfileConfigDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name: string;

  @IsEnum(ProfileSessionType)
  @IsOptional()
  type?: ProfileSessionType = ProfileSessionType.FULL;

  /**
   * How long to run the profiling session (seconds)
   */
  @IsInt()
  @Min(5)
  @Max(3600)
  @IsOptional()
  durationSeconds?: number = 60;

  /**
   * How frequently to capture snapshots (ms)
   */
  @IsInt()
  @Min(100)
  @Max(60000)
  @IsOptional()
  samplingIntervalMs?: number = 1000;

  /**
   * Threshold in ms above which a query is considered slow
   */
  @IsInt()
  @Min(1)
  @IsOptional()
  slowQueryThresholdMs?: number = 100;

  /**
   * Threshold in ms above which an API response is flagged
   */
  @IsInt()
  @Min(1)
  @IsOptional()
  slowApiThresholdMs?: number = 500;

  /**
   * Capture flame-graph compatible CPU samples
   */
  @IsBoolean()
  @IsOptional()
  enableFlameGraph?: boolean = false;

  /**
   * Capture V8 heap snapshots
   */
  @IsBoolean()
  @IsOptional()
  enableHeapSnapshot?: boolean = false;

  @IsObject()
  @IsOptional()
  extraConfig?: Record<string, any>;
}
