import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { IncidentStatus } from '../entities/incident.entity';

export class IncidentUpdateDto {
  @IsOptional()
  @IsEnum(IncidentStatus)
  status?: IncidentStatus;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  postMortem?: string;

  @IsOptional()
  @IsBoolean()
  publishedToStatusPage?: boolean;
}
