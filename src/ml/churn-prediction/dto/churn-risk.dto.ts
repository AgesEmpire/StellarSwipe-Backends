import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class ChurnRiskDto {
  @IsString()
  userId: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  riskScore: number;

  @IsString()
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  @IsNumber()
  daysSinceLastLogin?: number;

  @IsOptional()
  @IsNumber()
  engagementScore?: number;
}
