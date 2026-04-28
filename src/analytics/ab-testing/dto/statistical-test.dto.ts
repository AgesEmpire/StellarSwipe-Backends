import { IsString, IsNumber, IsBoolean } from 'class-validator';

export class StatisticalTestDto {
  @IsString()
  testType!: 'chi-square' | 't-test' | 'bayesian';

  @IsNumber()
  statistic!: number;

  @IsNumber()
  pValue!: number;

  @IsBoolean()
  isSignificant!: boolean;

  @IsNumber()
  effectSize!: number;

  confidenceInterval!: [number, number];
}
