import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import {
  Signal,
  SignalStatus,
  SignalOutcome,
  SignalType,
} from '../entities/signal.entity';
import { SignalPerformance } from '../entities/signal-performance.entity';
import { SdexPriceService } from './sdex-price.service';
import {
  CreateSignalDto,
  UpdateSignalDto,
  SignalQueryDto,
  PerformanceQueryDto,
} from '../dto';

@Injectable()
export class SignalPerformanceService {

  constructor(
    @InjectRepository(Signal)
    private signalRepository: Repository<Signal>,
    @InjectRepository(SignalPerformance)
    private performanceRepository: Repository<SignalPerformance>,
    private sdexPriceService: SdexPriceService,
  ) {}

  async createSignal(dto: CreateSignalDto): Promise<Signal> {
    const entryPrice = parseFloat(dto.entryPrice);
    const targetPrice = parseFloat(dto.targetPrice);
    const stopLossPrice = parseFloat(dto.stopLossPrice);

    if (dto.type === SignalType.BUY) {
      if (targetPrice <= entryPrice) {
        throw new BadRequestException(
          'Target price must be higher than entry price for BUY signals',
        );
      }
      if (stopLossPrice >= entryPrice) {
        throw new BadRequestException(
          'Stop loss price must be lower than entry price for BUY signals',
        );
      }
    } else {
      if (targetPrice >= entryPrice) {
        throw new BadRequestException(
          'Target price must be lower than entry price for SELL signals',
        );
      }
      if (stopLossPrice <= entryPrice) {
        throw new BadRequestException(
          'Stop loss price must be higher than entry price for SELL signals',
        );
      }
    }

    const signal = this.signalRepository.create({
      providerId: dto.providerId,
      baseAsset: dto.baseAsset,
      counterAsset: dto.counterAsset,
      type: dto.type,
      entryPrice: dto.entryPrice,
      targetPrice: dto.targetPrice,
      stopLossPrice: dto.stopLossPrice,
      expiresAt: new Date(dto.expiresAt),
      description: dto.description,
      metadata: dto.metadata,
      status: SignalStatus.ACTIVE,
      outcome: SignalOutcome.PENDING,
    });

    return this.signalRepository.save(signal);
  }

  async getSignal(id: string): Promise<Signal> {
    const signal = await this.signalRepository.findOne({
      where: { id },
      relations: ['performanceHistory'],
    });

    if (!signal) {
      throw new NotFoundException('Signal not found');
    }

    return signal;
  }

  async listSignals(query: SignalQueryDto): Promise<{
    data: Signal[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const whereConditions: Record<string, unknown> = {};

    if (query.providerId) {
      whereConditions.providerId = query.providerId;
    }
    if (query.status) {
      whereConditions.status = query.status;
    }
    if (query.type) {
      whereConditions.type = query.type;
    }
    if (query.baseAsset) {
      whereConditions.baseAsset = query.baseAsset;
    }
    if (query.counterAsset) {
      whereConditions.counterAsset = query.counterAsset;
    }

    const [data, total] = await this.signalRepository.findAndCount({
      where: whereConditions,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async updateSignal(id: string, dto: UpdateSignalDto): Promise<Signal> {
    const signal = await this.getSignal(id);

    if (dto.status) {
      signal.status = dto.status;
    }
    if (dto.outcome) {
      signal.outcome = dto.outcome;
    }
    if (dto.currentPrice !== undefined) {
      signal.currentPrice = dto.currentPrice;
    }
    if (dto.closePrice !== undefined) {
      signal.closePrice = dto.closePrice;
    }
    if (dto.copiersCount !== undefined) {
      signal.copiersCount = dto.copiersCount;
    }
    if (dto.totalCopiedVolume !== undefined) {
      signal.totalCopiedVolume = dto.totalCopiedVolume;
    }
    if (dto.metadata) {
      signal.metadata = { ...signal.metadata, ...dto.metadata };
    }

    return this.signalRepository.save(signal);
  }

  async closeSignal(
    id: string,
    outcome: SignalOutcome,
    closePrice: string,
  ): Promise<Signal> {
    const signal = await this.getSignal(id);

    if (signal.status !== SignalStatus.ACTIVE) {
      throw new BadRequestException('Signal is not active');
    }

    signal.status = SignalStatus.CLOSED;
    signal.outcome = outcome;
    signal.closePrice = closePrice;
    signal.closedAt = new Date();

    return this.signalRepository.save(signal);
  }

  async recordPerformance(signalId: string): Promise<SignalPerformance | null> {
    const signal = await this.getSignal(signalId);

    if (signal.status !== SignalStatus.ACTIVE) {
      return null;
    }

    const priceResult = await this.sdexPriceService.getPrice(
      signal.baseAsset,
      signal.counterAsset,
    );

    const currentPrice = priceResult.available ? priceResult.price : signal.currentPrice || signal.entryPrice;

    const pnlPercentage = this.sdexPriceService.calculatePnlPercentage(
      signal.entryPrice,
      currentPrice,
    );

    const pnlAbsolute = this.sdexPriceService.calculatePnlAbsolute(
      signal.entryPrice,
      currentPrice,
    );

    const distanceToTarget = this.sdexPriceService.calculateDistanceToTarget(
      currentPrice,
      signal.targetPrice,
      signal.entryPrice,
    );

    const distanceToStopLoss = this.sdexPriceService.calculateDistanceToStopLoss(
      currentPrice,
      signal.stopLossPrice,
      signal.entryPrice,
    );

    const timeElapsedSeconds = Math.floor(
      (Date.now() - signal.createdAt.getTime()) / 1000,
    );

    const lastPerformance = await this.performanceRepository.findOne({
      where: { signalId },
      order: { checkedAt: 'DESC' },
    });

    const maxDrawdown = Math.min(
      parseFloat(lastPerformance?.maxDrawdown || '0'),
      parseFloat(pnlPercentage),
    ).toFixed(4);

    const maxProfit = Math.max(
      parseFloat(lastPerformance?.maxProfit || '0'),
      parseFloat(pnlPercentage),
    ).toFixed(4);

    const performance = this.performanceRepository.create({
      signalId,
      priceAtCheck: currentPrice,
      pnlPercentage,
      pnlAbsolute,
      distanceToTarget,
      distanceToStopLoss,
      maxDrawdown,
      maxProfit,
      timeElapsedSeconds,
      copiersAtCheck: signal.copiersCount,
      volumeAtCheck: signal.totalCopiedVolume,
      priceSource: priceResult.source,
      isPriceAvailable: priceResult.available,
    });

    await this.signalRepository.update(signalId, {
      currentPrice,
    });

    return this.performanceRepository.save(performance);
  }

  async checkSignalOutcome(signalId: string): Promise<{
    signal: Signal;
    outcome: SignalOutcome;
    shouldClose: boolean;
  }> {
    const signal = await this.getSignal(signalId);

    if (signal.status !== SignalStatus.ACTIVE) {
      return { signal, outcome: signal.outcome, shouldClose: false };
    }

    if (new Date() > signal.expiresAt) {
      return { signal, outcome: SignalOutcome.EXPIRED, shouldClose: true };
    }

    const priceResult = await this.sdexPriceService.getPrice(
      signal.baseAsset,
      signal.counterAsset,
    );

    if (!priceResult.available) {
      return { signal, outcome: SignalOutcome.PENDING, shouldClose: false };
    }

    const currentPrice = priceResult.price;

    if (
      this.sdexPriceService.isTargetHit(
        currentPrice,
        signal.targetPrice,
        signal.type,
      )
    ) {
      return { signal, outcome: SignalOutcome.TARGET_HIT, shouldClose: true };
    }

    if (
      this.sdexPriceService.isStopLossHit(
        currentPrice,
        signal.stopLossPrice,
        signal.type,
      )
    ) {
      return { signal, outcome: SignalOutcome.STOP_LOSS_HIT, shouldClose: true };
    }

    return { signal, outcome: SignalOutcome.PENDING, shouldClose: false };
  }

  async getActiveSignals(): Promise<Signal[]> {
    return this.signalRepository.find({
      where: { status: SignalStatus.ACTIVE },
      order: { createdAt: 'DESC' },
    });
  }

  async getExpiredSignals(): Promise<Signal[]> {
    return this.signalRepository.find({
      where: {
        status: SignalStatus.ACTIVE,
        expiresAt: LessThan(new Date()),
      },
    });
  }

  async getPerformanceHistory(
    signalId: string,
    query: PerformanceQueryDto,
  ): Promise<{
    data: SignalPerformance[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const queryBuilder = this.performanceRepository
      .createQueryBuilder('performance')
      .where('performance.signal_id = :signalId', { signalId });

    if (query.from) {
      queryBuilder.andWhere('performance.checked_at >= :from', {
        from: new Date(query.from),
      });
    }
    if (query.to) {
      queryBuilder.andWhere('performance.checked_at <= :to', {
        to: new Date(query.to),
      });
    }

    const [data, total] = await queryBuilder
      .orderBy('performance.checked_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  async getSignalsByProvider(providerId: string): Promise<Signal[]> {
    return this.signalRepository.find({
      where: { providerId },
      order: { createdAt: 'DESC' },
    });
  }

  async incrementCopiers(signalId: string, volume: string): Promise<Signal> {
    const signal = await this.getSignal(signalId);

    signal.copiersCount += 1;
    signal.totalCopiedVolume = (
      parseFloat(signal.totalCopiedVolume) + parseFloat(volume)
    ).toFixed(8);

    return this.signalRepository.save(signal);
  }

  async getSignalStats(): Promise<{
    totalActiveSignals: number;
    totalClosedSignals: number;
    avgPnlActive: string;
    totalVolume: string;
  }> {
    const activeCount = await this.signalRepository.count({
      where: { status: SignalStatus.ACTIVE },
    });

    const closedCount = await this.signalRepository.count({
      where: { status: SignalStatus.CLOSED },
    });

    const activeSignals = await this.getActiveSignals();

    let totalPnl = 0;
    let totalVolume = 0;

    for (const signal of activeSignals) {
      if (signal.currentPrice) {
        const pnl = this.sdexPriceService.calculatePnlPercentage(
          signal.entryPrice,
          signal.currentPrice,
        );
        totalPnl += parseFloat(pnl);
      }
      totalVolume += parseFloat(signal.totalCopiedVolume);
    }

    const avgPnl =
      activeSignals.length > 0
        ? (totalPnl / activeSignals.length).toFixed(4)
        : '0';

    return {
      totalActiveSignals: activeCount,
      totalClosedSignals: closedCount,
      avgPnlActive: avgPnl,
      totalVolume: totalVolume.toFixed(8),
    };
  }
}
