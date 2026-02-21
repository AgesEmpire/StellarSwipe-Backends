import { IsEnum, IsString, IsOptional } from 'class-validator';
import { EngagementType } from '../entities/content-engagement.entity';

export class CreateEngagementDto {
  @IsEnum(EngagementType)
  type: EngagementType;

  @IsString()
  @IsOptional()
  flagReason?: string;
}
