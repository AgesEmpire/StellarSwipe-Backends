import { IsEnum, IsString, IsOptional, IsDateString } from 'class-validator';
import { SlaTierName } from '../interfaces/sla-tier.interface';

export class SlaConfigDto {
  @IsString()
  userId!: string;

  @IsString()
  clientName!: string;

  @IsEnum(SlaTierName)
  tier!: SlaTierName;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
