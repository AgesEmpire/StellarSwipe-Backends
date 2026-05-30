import { FraudDecision } from '../entities/fraud-score.entity';

export class RiskScoreResponseDto {
  transactionId!: string;
  userId!: string;
  totalScore!: number;
  decision!: FraudDecision;
  breakdown!: Record<string, number>;
  scoredAt!: Date;
}
