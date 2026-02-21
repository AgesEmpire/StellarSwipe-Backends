import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { StrategyTemplate } from './entities/strategy-template.entity';
import { UserStrategy, PerformanceMetrics } from './entities/user-strategy.entity';
import {
  ApplyStrategyDto,
  CreateCustomTemplateDto,
} from './dto/apply-strategy.dto';
import { StrategyPerformanceDto } from './dto/strategy-performance.dto';

import { conservativeTemplate } from './templates/conservative.template';
import { balancedTemplate } from './templates/balanced.template';
import { aggressiveTemplate } from './templates/aggressive.template';

export interface TradingSignal {
  id: string;
  providerReputation: number;
  confidence: number;
  asset: string;
  positionSize: number;
  stopLoss: number;
  [key: string]: any;
}

@Injectable()
export class StrategiesService {
  constructor(
    @InjectRepository(StrategyTemplate)
    private readonly templateRepo: Repository<StrategyTemplate>,
    @InjectRepository(UserStrategy)
    private readonly userStrategyRepo: Repository<UserStrategy>,
  ) {}

  // ─── Seed built-in templates on startup ───────────────────────────────────
  async onModuleInit(): Promise<void> {
    await this.seedBuiltInTemplates();
  }

  private async seedBuiltInTemplates(): Promise<void> {
    const builtIns = [conservativeTemplate, balancedTemplate, aggressiveTemplate];
    for (const tpl of builtIns) {
      const exists = await this.templateRepo.findOne({ where: { id: tpl.id } });
      if (!exists) {
        await this.templateRepo.save(tpl);
      }
    }
  }

  // ─── GET /strategies/templates ────────────────────────────────────────────
  async listTemplates(userId?: string): Promise<StrategyTemplate[]> {
    return this.templateRepo.find({
      where: [{ isCustom: false }, ...(userId ? [{ isCustom: true, createdBy: userId }] : [])],
      order: { createdAt: 'ASC' },
    });
  }

  async getTemplate(id: string): Promise<StrategyTemplate> {
    const tpl = await this.templateRepo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException(`Template "${id}" not found`);
    return tpl;
  }

  // ─── POST /strategies/apply ───────────────────────────────────────────────
  async applyTemplate(userId: string, dto: ApplyStrategyDto): Promise<UserStrategy> {
    const template = await this.getTemplate(dto.templateId);

    // Deactivate existing active strategy for this user (one active at a time)
    await this.userStrategyRepo
      .createQueryBuilder()
      .update(UserStrategy)
      .set({ isActive: false, deactivatedAt: new Date() })
      .where('userId = :userId AND isActive = true', { userId })
      .execute();

    // Validate overrides don't conflict with template's risk level
    if (dto.overrides) {
      this.validateOverrides(template, dto.overrides);
    }

    const userStrategy = this.userStrategyRepo.create({
      userId,
      templateId: template.id,
      isActive: true,
      customOverrides: dto.overrides ?? null,
      performanceMetrics: new PerformanceMetrics(),
      appliedAt: new Date(),
    });

    return this.userStrategyRepo.save(userStrategy);
  }

  // ─── Signal filtering ─────────────────────────────────────────────────────
  async filterSignal(
    userId: string,
    signal: TradingSignal,
  ): Promise<{ accepted: boolean; reasons: string[]; effectiveParams: StrategyTemplate['parameters'] }> {
    const userStrategy = await this.getActiveUserStrategy(userId);
    const effectiveParams = this.mergeParameters(userStrategy);

    const reasons: string[] = [];

    if (signal.providerReputation < effectiveParams.minProviderReputation) {
      reasons.push(
        `Provider reputation ${signal.providerReputation} below minimum ${effectiveParams.minProviderReputation}`,
      );
    }

    if (signal.confidence < effectiveParams.minSignalConfidence) {
      reasons.push(
        `Signal confidence ${signal.confidence}% below minimum ${effectiveParams.minSignalConfidence}%`,
      );
    }

    if (
      effectiveParams.preferredAssets.length > 0 &&
      !effectiveParams.preferredAssets.includes(signal.asset)
    ) {
      reasons.push(
        `Asset "${signal.asset}" not in preferred assets list`,
      );
    }

    if (signal.positionSize > effectiveParams.maxPositionSize) {
      reasons.push(
        `Position size ${signal.positionSize}% exceeds maximum ${effectiveParams.maxPositionSize}%`,
      );
    }

    const accepted = reasons.length === 0;

    // Track metrics
    await this.recordSignalOutcome(userStrategy, accepted);

    return { accepted, reasons, effectiveParams };
  }

  async getEffectiveParams(userId: string): Promise<StrategyTemplate['parameters']> {
    const userStrategy = await this.getActiveUserStrategy(userId);
    return this.mergeParameters(userStrategy);
  }

  // ─── Performance tracking ─────────────────────────────────────────────────
  async recordTradeResult(
    userId: string,
    tradeResult: { pnl: number; profitable: boolean; drawdown?: number },
  ): Promise<void> {
    const userStrategy = await this.getActiveUserStrategy(userId);
    const metrics = userStrategy.performanceMetrics;

    metrics.signalsExecuted += 1;
    if (tradeResult.profitable) metrics.profitableTrades += 1;
    metrics.totalPnl += tradeResult.pnl;
    metrics.winRate =
      metrics.signalsExecuted > 0
        ? (metrics.profitableTrades / metrics.signalsExecuted) * 100
        : 0;
    metrics.avgReturnPerTrade =
      metrics.signalsExecuted > 0 ? metrics.totalPnl / metrics.signalsExecuted : 0;

    if (tradeResult.drawdown && tradeResult.drawdown > metrics.maxDrawdown) {
      metrics.maxDrawdown = tradeResult.drawdown;
    }

    await this.userStrategyRepo.save(userStrategy);
  }

  async getPerformance(userId: string): Promise<StrategyPerformanceDto> {
    const userStrategy = await this.getActiveUserStrategy(userId);
    return this.toPerformanceDto(userStrategy);
  }

  async getPerformanceHistory(userId: string): Promise<StrategyPerformanceDto[]> {
    const strategies = await this.userStrategyRepo.find({
      where: { userId },
      relations: ['template'],
      order: { appliedAt: 'DESC' },
    });

    return strategies.map((s) => this.toPerformanceDto(s));
  }

  // ─── Custom templates ─────────────────────────────────────────────────────
  async createCustomTemplate(
    userId: string,
    dto: CreateCustomTemplateDto,
  ): Promise<StrategyTemplate> {
    const template = this.templateRepo.create({
      id: uuidv4(),
      name: dto.name,
      description: dto.description,
      riskLevel: dto.riskLevel,
      parameters: dto.parameters as StrategyTemplate['parameters'],
      isCustom: true,
      createdBy: userId,
    });
    return this.templateRepo.save(template);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  private async getActiveUserStrategy(userId: string): Promise<UserStrategy> {
    const userStrategy = await this.userStrategyRepo.findOne({
      where: { userId, isActive: true },
      relations: ['template'],
    });
    if (!userStrategy) {
      throw new NotFoundException(
        `No active strategy for user "${userId}". Apply a template first.`,
      );
    }
    return userStrategy;
  }

  private mergeParameters(
    userStrategy: UserStrategy,
  ): StrategyTemplate['parameters'] {
    const base = userStrategy.template.parameters;
    const overrides = userStrategy.customOverrides ?? {};
    return { ...base, ...overrides };
  }

  private async recordSignalOutcome(
    userStrategy: UserStrategy,
    accepted: boolean,
  ): Promise<void> {
    const metrics = userStrategy.performanceMetrics;
    metrics.totalSignalsReceived += 1;
    if (!accepted) metrics.signalsFiltered += 1;
    await this.userStrategyRepo.save(userStrategy);
  }

  private validateOverrides(
    template: StrategyTemplate,
    overrides: Partial<StrategyTemplate['parameters']>,
  ): void {
    const base = template.parameters;

    // Warn about potentially conflicting overrides (don't hard-block)
    if (
      overrides.defaultStopLoss !== undefined &&
      Math.abs(overrides.defaultStopLoss - base.defaultStopLoss) > base.defaultStopLoss * 2
    ) {
      throw new BadRequestException(
        `Stop-loss override ${overrides.defaultStopLoss}% deviates too much from template default ${base.defaultStopLoss}%. Consider using a different template.`,
      );
    }

    if (
      overrides.maxOpenPositions !== undefined &&
      overrides.maxOpenPositions > base.maxOpenPositions * 2
    ) {
      throw new BadRequestException(
        `maxOpenPositions override ${overrides.maxOpenPositions} exceeds twice the template limit ${base.maxOpenPositions}.`,
      );
    }
  }

  private toPerformanceDto(userStrategy: UserStrategy): StrategyPerformanceDto {
    const m = userStrategy.performanceMetrics;
    return {
      userStrategyId: userStrategy.id,
      templateId: userStrategy.templateId,
      templateName: userStrategy.template?.name ?? '',
      riskLevel: userStrategy.template?.riskLevel ?? '',
      totalSignalsReceived: m.totalSignalsReceived,
      signalsFiltered: m.signalsFiltered,
      signalsExecuted: m.signalsExecuted,
      profitableTrades: m.profitableTrades,
      totalPnl: m.totalPnl,
      winRate: m.winRate,
      avgReturnPerTrade: m.avgReturnPerTrade,
      maxDrawdown: m.maxDrawdown,
      sharpeRatio: m.sharpeRatio,
      filterRate:
        m.totalSignalsReceived > 0
          ? (m.signalsFiltered / m.totalSignalsReceived) * 100
          : 0,
      isActive: userStrategy.isActive,
      appliedAt: userStrategy.appliedAt,
    };
  }
}
