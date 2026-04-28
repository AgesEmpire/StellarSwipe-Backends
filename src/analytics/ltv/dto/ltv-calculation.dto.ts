import { IsString, IsNumber, IsEnum, Min, Max } from 'class-validator';

export class LtvCalculationDto {
  @IsString()
  userId!: string;

  @IsEnum(['free', 'basic', 'pro', 'enterprise'])
  subscriptionTier!: 'free' | 'basic' | 'pro' | 'enterprise';

  @IsNumber() @Min(0)
  monthsActive!: number;

  @IsNumber() @Min(0)
  totalTradeVolume!: number;

  @IsNumber() @Min(0)
  tradeCount!: number;

  @IsNumber() @Min(0)
  avgMonthlyRevenue!: number;

  @IsNumber() @Min(0) @Max(1)
  engagementScore!: number;

  @IsNumber() @Min(0) @Max(1)
  churnRisk!: number;
}
