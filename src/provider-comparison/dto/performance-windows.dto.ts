import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
} from 'class-validator';
import { PerformanceWindow, SUPPORTED_PERFORMANCE_WINDOWS } from '../performance-window';

export class PerformanceWindowsQueryDto {
  @ApiProperty({
    enum: PerformanceWindow,
    isArray: true,
    description: 'Comma-separated or repeated list of comparison windows',
    example: '7d,30d',
  })
  @Transform(({ value }) =>
    (Array.isArray(value) ? value : String(value ?? '').split(','))
      .map((v: unknown) => String(v).trim())
      .filter((v: string) => v.length > 0),
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SUPPORTED_PERFORMANCE_WINDOWS.length)
  @ArrayUnique()
  @IsEnum(PerformanceWindow, {
    each: true,
    message: `each window must be one of: ${SUPPORTED_PERFORMANCE_WINDOWS.join(', ')}`,
  })
  windows!: PerformanceWindow[];

  @ApiPropertyOptional({
    description: 'Evaluate windows as of this instant (ISO-8601). Defaults to now.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  asOf?: string;
}

export class WindowMetricsDto {
  @ApiProperty({ enum: PerformanceWindow })
  window!: PerformanceWindow;

  @ApiProperty({ description: 'Inclusive window start (ISO-8601)' })
  start!: string;

  @ApiProperty({ description: 'Exclusive window end (ISO-8601)' })
  end!: string;

  @ApiProperty({ description: 'Number of closed signals in the window' })
  sampleCount!: number;

  @ApiProperty()
  wins!: number;

  @ApiProperty()
  losses!: number;

  @ApiProperty({ nullable: true, type: Number, description: 'null when sampleCount is 0' })
  winRate!: number | null;

  @ApiProperty({ description: 'Sum of PnL over the window (0 when empty)' })
  totalPnl!: number;

  @ApiProperty({ nullable: true, type: Number, description: 'null when sampleCount is 0' })
  averagePnl!: number | null;
}

export class ProviderWindowPerformanceDto {
  @ApiProperty()
  providerId!: string;

  @ApiProperty({ description: 'Exclusive end shared by every window (ISO-8601)' })
  asOf!: string;

  @ApiProperty({ type: [WindowMetricsDto] })
  windows!: WindowMetricsDto[];
}
