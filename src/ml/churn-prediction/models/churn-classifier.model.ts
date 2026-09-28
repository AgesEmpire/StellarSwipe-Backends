import { Injectable } from '@nestjs/common';
import { computeEngagementScore, UserEngagementFeatures } from '../utils/engagement-scorer';

@Injectable()
export class ChurnClassifierModel {
  /**
   * Predicts churn risk score (0–1) from engagement features.
   * Uses a simple weighted heuristic; replace with trained model inference.
   */
  predict(features: UserEngagementFeatures): number {
    const engagement = computeEngagementScore(features);
    // Invert engagement: low engagement = high churn risk
    return parseFloat((1 - engagement / 100).toFixed(4));
  }
}
