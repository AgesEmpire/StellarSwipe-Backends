import { IsString, IsEnum, IsDateString, IsNumber, Min, IsOptional } from 'class-validator';
import { ContestMetric } from '../entities/contest.entity';

export class CreateContestDto {
  @IsString()
  name!: string;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  @IsEnum(ContestMetric)
  metric!: ContestMetric;

  @IsNumber()
  @Min(1)
  minSignals!: number;

  @IsString()
  prizePool!: string;
}

export class UpdateContestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @IsEnum(ContestMetric)
  metric?: ContestMetric;

  @IsOptional()
  @IsNumber()
  @Min(1)
  minSignals?: number;

  @IsOptional()
  @IsString()
  prizePool?: string;
}

export class ContestQueryDto {
  @IsOptional()
  @IsEnum(['ACTIVE', 'FINALIZED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number;
}

export interface ContestEntryDto {
  provider: string;
  signalsSubmitted: string[];
  totalRoi: string;
  successRate: number;
  totalVolume: string;
  score: string;
}

export interface ContestLeaderboardDto {
  contestId: string;
  contestName: string;
  metric: ContestMetric;
  entries: ContestEntryDto[];
  winners: string[] | null;
  status: string;
  endTime: Date;
}
