import { IsDate, IsOptional, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class AssignRoleDto {
  @IsUUID()
  @IsOptional()
  teamId?: string;

  @IsUUID()
  @IsOptional()
  organizationId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}
