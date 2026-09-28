import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class DuplicateCheckDto {
  @IsString()
  @IsNotEmpty()
  transactionId!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsString()
  @IsOptional()
  accountId?: string;
}

export class DuplicateCheckResultDto {
  accepted!: boolean;
  duplicate!: boolean;
  fingerprint!: string;
  reason?: string;
  firstSeenAt!: Date;
  expiresAt!: Date;
}
