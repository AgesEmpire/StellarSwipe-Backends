import {
  Injectable,
  Logger,
  TooManyRequestsException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { CreateSignalDto } from './dto/create-signal.dto';
import { SignalValidatorService } from './validators/signal-validator.service';
import { StakeValidatorService } from './validators/stake-validator.service';
import { Signal } from './entities/signal.entity';

export interface CreateSignalResult {
  signal: Signal;
  qualityScore: number;
  confidenceScore: number;
  stakeAmount: string;
}

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);
  private readonly DAILY_SIGNAL_LIMIT = 10;
  private readonly DEFAULT_EXPIRATION_HOURS = 24;

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    private readonly signalValidator: SignalValidatorService,
    private readonly stakeValidator: StakeValidatorService,
  ) {}

  /**
   * Creates a new signal with complete validation pipeline
   */
  async createSignal(
    dto: CreateSignalDto,
    providerId: string,
    providerAddress: string,
  ): Promise<CreateSignalResult> {
    this.logger.log(
      `Creating signal for provider ${providerId} (${dto.assetPair})`,
    );

    // Step 1: Verify provider stake via Soroban contract
    const stakeInfo = await this.stakeValidator.validateProviderStake(
      providerAddress,
    );

    // Step 2: Check rate limiting
    await this.checkRateLimit(providerId);

    // Step 3: Get recent signals for duplicate check
    const recentSignals = await this.getRecentSignals(providerId, 1); // Last 1 hour

    // Step 4: Validate signal data and get quality score
    const { qualityScore } = await this.signalValidator.validateSignal(
      dto,
      providerId,
      recentSignals,
    );

    // Step 5: Calculate overall confidence score
    const confidenceScore = this.calculateConfidenceScore(
      qualityScore,
      stakeInfo,
      providerId,
    );

    // Step 6: Create signal entity
    const expirationHours = dto.expiresIn || this.DEFAULT_EXPIRATION_HOURS;
    const expiresAt = new Date(
      Date.now() + expirationHours * 60 * 60 * 1000,
    );

    const signal = this.signalRepository.create({
      providerId,
      providerAddress,
      assetPair: dto.assetPair,
      action: dto.action,
      entryPrice: dto.entryPrice,
      targetPrice: dto.targetPrice,
      stopLoss: dto.stopLoss,
      rationale: dto.rationale,
      qualityScore,
      confidenceScore,
      stakeAmount: stakeInfo.amount,
      expiresAt,
      status: 'ACTIVE',
    });

    const savedSignal = await this.signalRepository.save(signal);

    this.logger.log(
      `Signal created successfully: ID ${savedSignal.id}, Confidence: ${confidenceScore}`,
    );

    return {
      signal: savedSignal,
      qualityScore,
      confidenceScore,
      stakeAmount: stakeInfo.amount,
    };
  }

  /**
   * Enforces rate limiting: 10 signals per provider per day
   */
  private async checkRateLimit(providerId: string): Promise<void> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const signalCount = await this.signalRepository.count({
      where: {
        providerId,
        createdAt: MoreThan(oneDayAgo),
      },
    });

    if (signalCount >= this.DAILY_SIGNAL_LIMIT) {
      const oldestSignal = await this.signalRepository.findOne({
        where: {
          providerId,
          createdAt: MoreThan(oneDayAgo),
        },
        order: {
          createdAt: 'ASC',
        },
      });

      const resetTime = new Date(
        oldestSignal.createdAt.getTime() + 24 * 60 * 60 * 1000,
      );

      throw new TooManyRequestsException(
        `Rate limit exceeded. You can submit ${this.DAILY_SIGNAL_LIMIT} signals per day. ` +
          `Your limit will reset at ${resetTime.toISOString()}`,
      );
    }
  }

  /**
   * Gets recent signals for a provider
   */
  private async getRecentSignals(
    providerId: string,
    hours: number,
  ): Promise<Signal[]> {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    return this.signalRepository.find({
      where: {
        providerId,
        createdAt: MoreThan(cutoffTime),
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Calculates overall confidence score based on multiple factors
   */
  private calculateConfidenceScore(
    qualityScore: number,
    stakeInfo: any,
    providerId: string,
  ): number {
    // Quality score: 0-100 points (weighted 50%)
    const qualityWeight = qualityScore * 0.5;

    // Stake confidence: 0-30 points (weighted 30%)
    const stakeConfidence = this.stakeValidator.calculateStakeConfidence(
      stakeInfo,
    );
    const stakeWeight = stakeConfidence * 0.3;

    // Provider history: 0-20 points (weighted 20%)
    // TODO: Implement provider history scoring based on past signal performance
    const historyWeight = 10; // Default neutral score

    const totalScore = qualityWeight + stakeWeight + historyWeight;

    // Round to 2 decimal places
    return Math.round(totalScore * 100) / 100;
  }

  /**
   * Gets all active signals
   */
  async getActiveSignals(): Promise<Signal[]> {
    const now = new Date();

    return this.signalRepository.find({
      where: {
        status: 'ACTIVE',
        expiresAt: MoreThan(now),
      },
      order: {
        confidenceScore: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Gets signals by provider
   */
  async getProviderSignals(providerId: string): Promise<Signal[]> {
    return this.signalRepository.find({
      where: {
        providerId,
      },
      order: {
        createdAt: 'DESC',
      },
      take: 50,
    });
  }

  /**
   * Gets a specific signal by ID
   */
  async getSignalById(id: string): Promise<Signal> {
    return this.signalRepository.findOne({
      where: { id },
    });
  }

  /**
   * Updates expired signals
   */
  async expireOldSignals(): Promise<number> {
    const now = new Date();

    const result = await this.signalRepository.update(
      {
        status: 'ACTIVE',
        expiresAt: MoreThan(now),
      },
      {
        status: 'EXPIRED',
      },
    );

    if (result.affected > 0) {
      this.logger.log(`Expired ${result.affected} old signals`);
    }

    return result.affected;
  }

  /**
   * Gets provider statistics
   */
  async getProviderStats(providerId: string) {
    const totalSignals = await this.signalRepository.count({
      where: { providerId },
    });

    const activeSignals = await this.signalRepository.count({
      where: {
        providerId,
        status: 'ACTIVE',
        expiresAt: MoreThan(new Date()),
      },
    });

    const todaySignals = await this.signalRepository.count({
      where: {
        providerId,
        createdAt: MoreThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      },
    });

    const avgConfidence = await this.signalRepository
      .createQueryBuilder('signal')
      .select('AVG(signal.confidenceScore)', 'avg')
      .where('signal.providerId = :providerId', { providerId })
      .getRawOne();

    return {
      totalSignals,
      activeSignals,
      todaySignals,
      remainingToday: Math.max(0, this.DAILY_SIGNAL_LIMIT - todaySignals),
      averageConfidence: parseFloat(avgConfidence?.avg || '0').toFixed(2),
    };
  }
}