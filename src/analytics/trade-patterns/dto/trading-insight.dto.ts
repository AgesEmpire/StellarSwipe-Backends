import { InsightType } from '../entities/pattern-insight.entity';

export class TradingInsightDto {
  insightType!: InsightType;
  title!: string;
  description!: string;
  patternType!: string;
  data?: Record<string, unknown>;
}
