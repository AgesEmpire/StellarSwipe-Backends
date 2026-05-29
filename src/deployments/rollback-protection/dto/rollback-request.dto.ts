import { IsString, MaxLength, IsOptional, IsBoolean } from 'class-validator';

export class RollbackRequestDto {
  @IsString()
  @MaxLength(100)
  serviceName!: string;

  @IsString()
  @MaxLength(50)
  targetVersion!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  forceOverride?: boolean;
}

export class RollbackStatusDto {
  requestId!: string;
  serviceName!: string;
  status!: 'approved' | 'pending_approval' | 'blocked';
  reason!: string;
  createdAt!: Date;
}
