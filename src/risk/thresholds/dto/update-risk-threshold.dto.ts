import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateRiskThresholdDto {
  @IsNumber()
  @Min(0)
  value!: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  updatedBy?: string;
}
