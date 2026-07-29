import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';

export class CreateApprovalRequestDto {
  @IsUUID()
  transactionId!: string;

  @IsString()
  @MaxLength(200)
  description!: string;

  @IsOptional()
  @IsString({ each: true })
  requiredApprovers?: string[];
}

export class SubmitApprovalDto {
  @IsUUID()
  approverId!: string;

  @IsString()
  mfaCode!: string;
}
