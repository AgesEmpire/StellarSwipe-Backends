import { IsOptional, IsString, IsUUID } from 'class-validator';

export class InvalidateSessionDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  // At least one of sessionId or userId must be provided — enforced in the service layer.
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsUUID()
  adminId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminSessionActionDto {
  @IsUUID()
  adminId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class InvalidateSessionResponseDto {
  invalidatedCount: number;
  sessionIds: string[];
  userId?: string;
  auditId: string;
  invalidatedAt: Date;
}
