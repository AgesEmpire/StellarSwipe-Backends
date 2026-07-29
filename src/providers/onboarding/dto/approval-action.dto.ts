import { IsUUID, IsEnum, IsOptional, IsString } from 'class-validator';

export class ApprovalActionDto {
  @IsUUID()
  applicationId: string;

  @IsEnum(['approve', 'reject'])
  action: 'approve' | 'reject';

  @IsUUID()
  adminId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
