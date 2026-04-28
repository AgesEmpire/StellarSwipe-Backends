import { IsNumber, IsString, IsArray, IsDate, IsOptional, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export enum ServiceStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  DOWN = 'down',
  UNKNOWN = 'unknown',
}

export class ServiceHealthDto {
  @IsString()
  serviceName: string;

  @IsString()
  status: ServiceStatus;

  @IsNumber()
  uptime: number; // Percentage

  @IsNumber()
  @IsOptional()
  responseTime: number; // In milliseconds

  @IsNumber()
  @IsOptional()
  errorRate: number; // Percentage

  @IsDate()
  @Type(() => Date)
  lastChecked: Date;

  @IsString()
  @IsOptional()
  details: string;
}

export class DatabaseHealthDto {
  @IsString()
  status: ServiceStatus;

  @IsNumber()
  connectionPoolUsage: number; // Percentage

  @IsNumber()
  databaseSize: number; // In MB

  @IsNumber()
  queryLatency: number; // In milliseconds

  @IsNumber()
  slowQueriesCount: number;

  @IsDate()
  @Type(() => Date)
  lastBackup: Date;

  @IsString()
  @IsOptional()
  details: string;
}

export class CacheHealthDto {
  @IsString()
  status: ServiceStatus;

  @IsNumber()
  hitRate: number; // Percentage

  @IsNumber()
  memoryUsage: number; // In MB

  @IsNumber()
  itemsCount: number;

  @IsNumber()
  evictionRate: number; // Per minute

  @IsDate()
  @Type(() => Date)
  lastChecked: Date;

  @IsString()
  @IsOptional()
  details: string;
}

export class AlertDto {
  @IsString()
  id: string;

  @IsString()
  severity: 'critical' | 'warning' | 'info';

  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsDate()
  @Type(() => Date)
  timestamp: Date;

  @IsBoolean()
  @IsOptional()
  acknowledged: boolean;
}

export class SystemHealthDto {
  @IsString()
  overallStatus: ServiceStatus;

  @IsNumber()
  systemUptime: number; // Percentage

  @IsNumber()
  cpuUsage: number; // Percentage

  @IsNumber()
  memoryUsage: number; // Percentage

  @IsNumber()
  diskUsage: number; // Percentage

  @ValidateNested()
  @Type(() => DatabaseHealthDto)
  database: DatabaseHealthDto;

  @ValidateNested()
  @Type(() => CacheHealthDto)
  cache: CacheHealthDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceHealthDto)
  services: ServiceHealthDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertDto)
  @IsOptional()
  alerts: AlertDto[];

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  lastUpdated: Date;

  @IsNumber()
  @IsOptional()
  activeIncidents: number;

  @IsNumber()
  @IsOptional()
  mttr: number; // Mean Time To Recovery in hours
}
