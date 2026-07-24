import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signal, SignalStatus, SignalType } from './entities/signal.entity';
import { CacheService, CachePrefix } from '../cache/cache.service';
import { SignalQuotaService } from './quota/signal-quota.service';
import { CreateSignalDto } from './dto';

export interface PaginatedSignalsDto {
  data: Signal[];
  total: number;
  limit: number;
  offset: number;
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

@Injectable()
export class SignalsService {

  private static readonly FEED_KEY = `${CachePrefix.SIGNAL}feed`;

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    private readonly cacheService: CacheService,
    private readonly quotaService: SignalQuotaService,
  ) {}

  async create(createSignalDto: CreateSignalDto): Promise<Signal> {
    if (!createSignalDto.providerId || !createSignalDto.baseAsset || !createSignalDto.counterAsset) {
      throw new BadRequestException('providerId, baseAsset, and counterAsset are required');
    }

    // Enforce quota — throws ForbiddenException when exceeded
    await this.quotaService.checkAndConsume(
      createSignalDto.providerId,
      createSignalDto.tier ?? 'basic',
      createSignalDto.isStaked ?? false,
    );

    const signal = this.signalRepository.create({
      providerId: createSignalDto.providerId,
      baseAsset: createSignalDto.baseAsset,
      counterAsset: createSignalDto.counterAsset,
      type: createSignalDto.type || SignalType.BUY,
      status: SignalStatus.ACTIVE,
      outcome: createSignalDto.outcome,
      entryPrice: createSignalDto.entryPrice || '0',
      targetPrice: createSignalDto.targetPrice || '0',
      stopLossPrice: createSignalDto.stopLossPrice || null,
      currentPrice: null,
      closePrice: null,
      copiersCount: 0,
      totalCopiedVolume: '0',
      expiresAt: createSignalDto.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: null,
      closedAt: null,
      rationale: createSignalDto.rationale || null,
      confidenceScore: createSignalDto.confidenceScore || 50,
      executedCount: 0,
      totalProfitLoss: '0',
      successRate: 0,
      metadata: createSignalDto.metadata || null,
    } as any);

    return this.signalRepository.save(signal as any);
  }

  async findOne(id: string): Promise<Signal | null> {
    const key = `${CachePrefix.SIGNAL}${id}`;
    return this.cacheService.getOrSetWithLock(
      key,
      () => this.signalRepository.findOneBy({ id }),
      'signal',
    );
  }

  async findAll(): Promise<Signal[]> {
    return this.cacheService.getOrSetWithLock(
      SignalsService.FEED_KEY,
      () => this.signalRepository.find({ order: { createdAt: 'DESC' }, take: 100 }),
      'signal',
    );
  }

  /**
   * Paginated signal feed with eager-loaded provider relation
   * to prevent N+1 queries when controllers access signal.provider.
   *
   * Uses skip/take for backward-compatible offset pagination.
   */
  async findPaginated(
    page = 1,
    limit = 20,
    sortBy: 'createdAt' | 'confidenceScore' | 'successRate' = 'createdAt',
    asset?: string,
  ): Promise<PaginatedSignalsDto> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const offset = (Math.max(page, 1) - 1) * safeLimit;

    const qb = this.signalRepository
      .createQueryBuilder('signal')
      .leftJoinAndSelect('signal.provider', 'provider')
      .orderBy(`signal.${sortBy}`, 'DESC');

    if (asset) {
      qb.where('signal.base_asset = :asset OR signal.counter_asset = :asset', { asset });
    }

    const [data, total] = await qb.skip(offset).take(safeLimit).getManyAndCount();
    const totalPages = Math.ceil(total / safeLimit);

    return {
      data,
      total,
      limit: safeLimit,
      offset,
      page,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  /**
   * Batch-load signals by IDs in a single query.
   * Use with BatchLoaderService to prevent N+1 when resolving signal relations.
   */
  async findByIds(ids: string[]): Promise<Signal[]> {
    if (ids.length === 0) return [];
    return this.signalRepository
      .createQueryBuilder('signal')
      .leftJoinAndSelect('signal.provider', 'provider')
      .where('signal.id IN (:...ids)', { ids })
      .getMany();
  }

  async updateSignalStatus(id: string, status: SignalStatus, currentVersion?: number): Promise<Signal | null> {
    if (currentVersion !== undefined) {
      const result = await this.signalRepository.update(
        { id, version: currentVersion },
        { status, version: currentVersion + 1 },
      );
      if (result.affected === 0) {
        throw new ConflictException('Signal was updated by another request. Please retry with the latest version.');
      }
    } else {
      await this.signalRepository.update(id, { status });
    }
    await Promise.all([
      this.cacheService.del(`${CachePrefix.SIGNAL}${id}`),
      this.cacheService.del(SignalsService.FEED_KEY),
    ]);
    return this.signalRepository.findOneBy({ id });
  }
}
