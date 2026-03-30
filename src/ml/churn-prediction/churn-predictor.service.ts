import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChurnPrediction } from './entities/churn-prediction.entity';
import { RetentionCampaign } from './entities/retention-campaign.entity';
import { ChurnClassifierModel } from './models/churn-classifier.model';
import { RiskScorerModel } from './models/risk-scorer.model';
import { selectIntervention } from './utils/intervention-selector';
import { ChurnRiskDto } from './dto/churn-risk.dto';
import { UserEngagementFeatures } from './utils/engagement-scorer';

@Injectable()
export class ChurnPredictorService {
  private readonly logger = new Logger(ChurnPredictorService.name);

  constructor(
    @InjectRepository(ChurnPrediction)
    private readonly predictionRepo: Repository<ChurnPrediction>,
    @InjectRepository(RetentionCampaign)
    private readonly campaignRepo: Repository<RetentionCampaign>,
    private readonly classifier: ChurnClassifierModel,
    private readonly riskScorer: RiskScorerModel,
  ) {}

  async predictForUser(userId: string, features: UserEngagementFeatures): Promise<ChurnRiskDto> {
    const riskScore = this.classifier.predict(features);
    const riskLevel = this.riskScorer.classify(riskScore);

    const prediction = this.predictionRepo.create({
      userId,
      riskScore,
      riskLevel,
      daysSinceLastLogin: features.daysSinceLastLogin,
      engagementScore: features.loginFrequency7d * 10, // simplified
    });
    await this.predictionRepo.save(prediction);

    return { userId, riskScore, riskLevel, daysSinceLastLogin: features.daysSinceLastLogin };
  }

  async triggerRetention(prediction: ChurnPrediction): Promise<RetentionCampaign> {
    const actionType = selectIntervention(prediction.riskLevel, prediction.engagementScore ?? 50);
    const campaign = this.campaignRepo.create({
      userId: prediction.userId,
      churnPredictionId: prediction.id,
      actionType,
      message: `Retention campaign: ${actionType} for user ${prediction.userId}`,
    });
    await this.campaignRepo.save(campaign);
    await this.predictionRepo.update(prediction.id, { retentionTriggered: true });
    this.logger.log(`Retention triggered for user ${prediction.userId} via ${actionType}`);
    return campaign;
  }

  async getHighRiskUsers(): Promise<ChurnPrediction[]> {
    return this.predictionRepo
      .createQueryBuilder('p')
      .where('p.riskLevel IN (:...levels)', { levels: ['high', 'critical'] })
      .andWhere('p.retentionTriggered = false')
      .orderBy('p.riskScore', 'DESC')
      .getMany();
  }
}
