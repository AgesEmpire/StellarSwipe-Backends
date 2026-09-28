import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PnlSnapshotStatusDto {
  @ApiProperty({ description: 'Whether an hourly snapshot run is currently active' })
  inProgress!: boolean;

  @ApiPropertyOptional({ description: 'Timestamp when the last run started' })
  lastRunStartedAt?: string;

  @ApiPropertyOptional({ description: 'Timestamp when the last successful run completed' })
  lastSuccessfulRunAt?: string;

  @ApiPropertyOptional({ description: 'Timestamp when the most recent run completed' })
  lastRunCompletedAt?: string;

  @ApiProperty({ description: 'Number of users with open positions processed by the last run' })
  usersProcessed!: number;

  @ApiProperty({ description: 'Number of P&L rows inserted by the last run' })
  snapshotsWritten!: number;

  @ApiProperty({ description: 'Number of expired rows removed by the last run' })
  snapshotsDeleted!: number;

  @ApiPropertyOptional({ description: 'Most recent run error, if any' })
  lastError?: string;
}
