import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FraudRule } from './entities/fraud-rule.entity';
import { FraudScore, FraudDecision } from './entities/fraud-score.entity';
import { CreateFraudRuleDto, ScoreTransactionDto } from './dto/fraud-rule.dto';
import { RiskScoreResponseDto } from './dto/risk-score.dto';

const REVIEW_THRESHOLD = 50;
const BLOCK_THRESHOLD = 80;

@Injectable()
export class FraudScoringService {
  private readonly logger = new Logger(FraudScoringService.name);

  constructor(
    @InjectRepository(FraudRule)
    private readonly ruleRepo: Repository<FraudRule>,
    @InjectRepository(FraudScore)
    private readonly scoreRepo: Repository<FraudScore>,
  ) {}

  async createRule(dto: CreateFraudRuleDto): Promise<FraudRule> {
    const rule = this.ruleRepo.create(dto);
    return this.ruleRepo.save(rule);
  }

  async listRules(): Promise<FraudRule[]> {
    return this.ruleRepo.find({ where: { isActive: true } });
  }

  async scoreTransaction(dto: ScoreTransactionDto): Promise<RiskScoreResponseDto> {
    const rules = await this.listRules();
    const breakdown: Record<string, number> = {};
    let totalScore = 0;

    for (const rule of rules) {
      const score = this.evaluateRule(rule, dto);
      breakdown[rule.name] = score;
      totalScore += score;
    }

    totalScore = Math.min(totalScore, 100);

    const decision =
      totalScore >= BLOCK_THRESHOLD
        ? FraudDecision.BLOCK
        : totalScore >= REVIEW_THRESHOLD
        ? FraudDecision.REVIEW
        : FraudDecision.ALLOW;

    const scoreEntity = this.scoreRepo.create({
      transactionId: dto.transactionId,
      userId: dto.userId,
      totalScore,
      decision,
      breakdown,
    });

    const saved = await this.scoreRepo.save(scoreEntity);

    if (decision !== FraudDecision.ALLOW) {
      this.logger.warn(`Fraud ${decision} for tx ${dto.transactionId} — score: ${totalScore}`);
    }

    return {
      transactionId: saved.transactionId,
      userId: saved.userId,
      totalScore: saved.totalScore,
      decision: saved.decision,
      breakdown: saved.breakdown ?? {},
      scoredAt: saved.createdAt,
    };
  }

  private evaluateRule(rule: FraudRule, dto: ScoreTransactionDto): number {
    const conditions = rule.conditions ?? {};
    if (rule.ruleType === 'amount' && conditions['maxAmount']) {
      return dto.amount > conditions['maxAmount'] ? rule.scoreWeight : 0;
    }
    return 0;
  }

  async getScoreHistory(userId: string): Promise<FraudScore[]> {
    return this.scoreRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }
}
