import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { IncidentSeverity } from '../entities/incident.entity';

export class CreateIncidentDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsEnum(IncidentSeverity)
  severity: IncidentSeverity;
}
