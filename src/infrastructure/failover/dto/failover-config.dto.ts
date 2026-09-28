import { IsString, IsArray, IsInt, Min } from 'class-validator';

export interface RegionConfig {
  name: string;
  endpoint: string;
  priority: number;
  healthCheckUrl: string;
  enabled: boolean;
}

export class FailoverConfigDto {
  @IsString()
  primaryRegion: string;

  @IsArray()
  failoverRegions: RegionConfig[];

  @IsInt()
  @Min(1000)
  healthCheckIntervalMs: number = 30_000;

  @IsInt()
  @Min(1)
  failureThreshold: number = 3;

  @IsInt()
  @Min(1)
  recoveryThreshold: number = 2;
}

export interface FailoverEvent {
  triggeredAt: Date;
  fromRegion: string;
  toRegion: string;
  reason: string;
  requestPath?: string;
}
