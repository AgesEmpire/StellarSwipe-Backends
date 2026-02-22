export class PositionSizeResultDto {
  recommendedSize: number;
  method: string;
  rationale: string;
  riskAmount: number;
  maxLoss: number;
  warnings?: string[];
}
