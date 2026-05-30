import { IsInt, IsOptional, Min, Max, IsString } from 'class-validator';

export class RotationScheduleDto {
  @IsInt()
  @Min(1)
  @Max(365)
  rotationIntervalDays!: number;

  @IsOptional()
  @IsString()
  notificationEmail?: string;
}

export class RotationResultDto {
  keyId!: string;
  newKey!: string;
  rotatedAt!: Date;
  nextRotationAt!: Date;
}
