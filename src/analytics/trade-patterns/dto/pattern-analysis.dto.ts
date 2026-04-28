import { IsUUID, IsOptional, IsDateString } from 'class-validator';

export class PatternAnalysisDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
