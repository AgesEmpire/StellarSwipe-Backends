import { IsDateString, IsOptional, IsEnum } from 'class-validator';
import { AuditAction } from '../../entities/audit-log.entity';

export class AuditExportRequestDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsEnum(AuditAction)
  eventType?: AuditAction;
}
