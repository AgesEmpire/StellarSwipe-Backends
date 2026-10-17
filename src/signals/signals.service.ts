import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Signal, SignalStatus, SignalType } from './entities/signal.entity';
import { CacheService, CachePrefix } from '../cache/cache.service';
import { SignalQuotaService } from './quota/signal-quota.service';
import {
  CreateSignalDto,
  PaginatedSignalsQueryDto,
  PaginatedSignalsResponseDto,
} from './dto';

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

export type SignalCancellationActor = 'provider' | 'administrator';

export interface SignalCancellationMetadata {
  reason: string;
  actor: SignalCancellationActor;
  actorId?: string;
  cancelledAt: string;
}

export interface CancelSignalOptions {
  reason: string;
  actor: SignalCancellationActor;
  actorId?: string;
  currentVersion?: number;
}

@Injectable()
export class SignalsService {
  private static readonly FEED_KEY = `${CachePrefix.SIGNAL}feed`;
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    private readonly cacheService: CacheService,
    private readonly quotaService: SignalQuotaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(createSignalDto: CreateSignalDto): Promise<Signal> {
    if (
      !createSignalDto.providerId ||
      !createSignalDto.baseAsset ||
      !createSignalDto.counterAsset
    ) {
      throw new BadRequestException(
        'providerId, baseAsset, and counterAsset are required',
      );
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
      expiresAt:
        createSignalDto.expiresAt ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: null,
      closedAt: null,
      rationale: createSignalDto.rationale || null,
      confidenceScore: createSignalDto.confidenceScore || 50,
      executedCount: 0,
      totalProfitLoss: '0',
      successRate: 0,
      metadata: createSignalDto.metadata || null,
    } as any);

    const saved = await this.signalRepository.save(signal as any);
    this.emitSafely('signal.created', saved);
    return saved;
  }

  async findOne(id: string): Promise<Signal | null> {
    const key = `${CachePrefix.SIGNAL}${id}`;
    return this.cacheService.getOrSetWithLock(
      key,
      () => this.signalRepository.findOneBy({ id }),
      'signal',
    );
  }

  /**
   * Encode a cursor from a signal's ID and creation timestamp.
   * Format: base64("id:timestamp")
   */
  private encodeCursor(signal: Signal): string {
    const timestamp = signal.createdAt.getTime().toString();
    const cursorData = `${signal.id}:${timestamp}`;
    return Buffer.from(cursorData).toString('base64');
  }

  /**
   * Decode a cursor back into ID and timestamp components.
   * Throws BadRequestException if cursor is invalid.
   */
  private decodeCursor(cursor: string): { id: string; timestamp: number } {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      const [id, timestamp] = decoded.split(':');
      if (!id || !timestamp) {
        throw new Error('Invalid cursor format');
      }
      return { id, timestamp: parseInt(timestamp, 10) };
    } catch {
      throw new BadRequestException('Invalid cursor format');
    }
  }

  /**
   * Cursor-based paginated signals feed endpoint.
   * Returns the most recent signals with cursor for pagination.
   *
   * Cursor-based pagination is preferred over offset pagination for feeds
   * because it remains stable when new records are inserted between pages.
   *
   * @param query - Contains optional cursor and limit (default 20, max 50)
   * @returns Paginated response with data, nextCursor, and hasMore flag
   */
  async findAll(
    query?: PaginatedSignalsQueryDto,
  ): Promise<PaginatedSignalsResponseDto> {
    const limit = Math.min(Math.max(query?.limit ?? 20, 1), 50);
    let filters: any = {};

    // If a cursor is provided, decode it and filter for signals created before it
    if (query?.cursor) {
      const { timestamp } = this.decodeCursor(query.cursor);
      filters.createdAt = LessThan(new Date(timestamp));
    }

    // Fetch limit + 1 to determine if there are more results
    const signals = await this.signalRepository.find({
      where: filters,
      relations: ['provider'],
      order: { createdAt: 'DESC' },
      take: limit + 1,
    });

    const hasMore = signals.length > limit;
    const data = hasMore ? signals.slice(0, limit) : signals;

    // Generate next cursor from the last signal if there are more results
    const nextCursor =
      hasMore && data.length > 0
        ? this.encodeCursor(data[data.length - 1])
        : undefined;

    return {
      data,
      nextCursor,
      hasMore,
      limit,
    };
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
      qb.where('signal.base_asset = :asset OR signal.counter_asset = :asset', {
        asset,
      });
    }

    const [data, total] = await qb
      .skip(offset)
      .take(safeLimit)
      .getManyAndCount();
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

  async updateSignalStatus(
    id: string,
    status: SignalStatus,
    currentVersion?: number,
  ): Promise<Signal | null> {
    if (currentVersion !== undefined) {
      const result = await this.signalRepository.update(
        { id, version: currentVersion },
        { status, version: currentVersion + 1 },
      );
      if (result.affected === 0) {
        throw new ConflictException(
          'Signal was updated by another request. Please retry with the latest version.',
        );
      }
    } else {
      await this.signalRepository.update(id, { status });
    }
    await Promise.all([
      this.cacheService.del(`${CachePrefix.SIGNAL}${id}`),
      this.cacheService.del(SignalsService.FEED_KEY),
    ]);
    const updated = await this.signalRepository.findOneBy({ id });
    if (updated) this.emitSafely('signal.updated', updated);
    return updated;
  }

  /**
   * Cancel a signal, persisting structured cancellation metadata exactly once.
   *
   * The first cancellation wins: if the signal is already cancelled, the
   * existing metadata is preserved and returned unchanged (idempotent).
   * Cancellation metadata is stored on the signal's `metadata` field under
   * the `cancellation` key so it is only exposed through authorized reads
   * (findOne / findByIds / findPaginated), never via public feed projections.
   */
  async cancelSignal(
    id: string,
    options: CancelSignalOptions,
  ): Promise<Signal | null> {
    if (!options?.reason || !options.reason.trim()) {
      throw new BadRequestException('A cancellation reason is required');
    }
    if (options.actor !== 'provider' && options.actor !== 'administrator') {
      throw new BadRequestException(
        'Cancellation actor must be provider or administrator',
      );
    }

    const existing = await this.signalRepository.findOneBy({ id });
    if (!existing) {
      return null;
    }

    // Idempotent: first cancellation wins, preserve existing metadata.
    if (existing.status === SignalStatus.CANCELLED) {
      return existing;
    }

    const cancellation: SignalCancellationMetadata = {
      reason: options.reason.trim(),
      actor: options.actor,
      actorId: options.actorId,
      cancelledAt: new Date().toISOString(),
    };

    const metadata = {
      ...(existing.metadata ?? {}),
      cancellation,
    };

    const updatePayload: any = {
      status: SignalStatus.CANCELLED,
      metadata,
    };

    if (options.currentVersion !== undefined) {
      updatePayload.version = options.currentVersion + 1;
      const result = await this.signalRepository.update(
        {
          id,
          version: options.currentVersion,
          status: SignalStatus.ACTIVE,
        },
        updatePayload,
      );
      if (result.affected === 0) {
        // Either a concurrent cancellation won (idempotent) or a version clash.
        const current = await this.signalRepository.findOneBy({ id });
        if (current?.status === SignalStatus.CANCELLED) {
          return current;
        }
        throw new ConflictException(
          'Signal was updated by another request. Please retry with the latest version.',
        );
      }
    } else {
      // Guard on ACTIVE status so only the first cancellation persists metadata.
      const result = await this.signalRepository.update(
        { id, status: SignalStatus.ACTIVE },
        updatePayload,
      );
      if (result.affected === 0) {
        const current = await this.signalRepository.findOneBy({ id });
        return current;
      }
    }

    await Promise.all([
      this.cacheService.del(`${CachePrefix.SIGNAL}${id}`),
      this.cacheService.del(SignalsService.FEED_KEY),
    ]);

    const updated = await this.signalRepository.findOneBy({ id });
    if (updated) this.emitSafely('signal.updated', updated);
    return updated;
  }

  /**
   * Read cancellation metadata for a signal. Callers must enforce
   * authorization before invoking this method.
   */
  async getCancellationMetadata(
    id: string,
  ): Promise<SignalCancellationMetadata | null> {
    const signal = await this.findOne(id);
    if (!signal) return null;
    const cancellation = (signal.metadata as any)?.cancellation;
    return cancellation ?? null;
  }

  /**
   * Fire an enti