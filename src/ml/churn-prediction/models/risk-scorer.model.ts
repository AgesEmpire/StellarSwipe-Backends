import { Injectable } from '@nestjs/common';

@Injectable()
export class RiskScorerModel {
  /**
   * Maps a raw churn probability to a risk level bucket.
   */
  classify(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.35) return 'medium';
    return 'low';
  }
}
