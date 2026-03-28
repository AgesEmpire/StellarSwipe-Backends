import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  IsIn,
} from 'class-validator';
import type { CompetitionRules } from '../interfaces/competition-rules.interface';

export class CreateCompetitionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @IsOptional()
  @IsObject()
  rules?: CompetitionRules;

  @IsOptional()
  @IsString()
  @IsIn(['PNL', 'ROI_BPS', 'VOLUME', 'WIN_RATE', 'COMPOSITE'])
  scoringMetric?: string;

  @IsNumberString()
  prizePoolTotal!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  currency?: string;

  @IsOptional()
  distributionRules?: unknown;
}
