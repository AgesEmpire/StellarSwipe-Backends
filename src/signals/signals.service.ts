import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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

/**
 * Provider suspension state, tracked in-memory for enforcement and auditing.
 * Suspended providers cannot create new signals or accept new followers.
 */
export interface ProviderSuspension {
  providerId: string;
  suspended: boolean;
  reason: string | null;
  actorId: string | null;
  suspendedAt: Date | null;
  liftedAt: Date | null;
}

export interface SuspensionAuditEntry {
  providerId: string;
  action: 'suspend' | 'unsuspend';
  actorId: string;
  reason: string | null;
  timestamp: Date;
}

/**
 * Configurable publication limits applied per provider.
 * - maxSignalsPerWindow: max signals published within windowMs
 * - maxActiveSignals: max outstanding (ACTIVE) signals at any time
 */
export interface SignalPublicationLimits {
  maxSignalsPerWindow: number;
  windowMs: number;
  maxActiveSignals: number;
}

export const DEFAULT_SIGNAL_PUBLICATION_LIMITS: SignalPublicationLimits = {
  maxSignalsPerWindow: 10,
  windowMs: 60 * 60 * 1000,
  maxActiveSignals: 50,
};

/**
 * Identifies which publication limit was exceeded so callers can surface it.
 */
export type SignalPublicationLimitType =
  | 'frequency'
  | 'active_signals';

@Injectable()
export class SignalsService {
  private static readonly FEED_KEY = `${CachePrefix.SIGNAL}feed`;
  private readonly logger = new Logger(SignalsService.name);
  private readonly suspensions = new Map<string, ProviderSuspension>();
  private readonly suspensionAudit: SuspensionAuditEntry[] = [];

  private readonly publicationLimits = new Map<
    string,
    SignalPublicationLimits
  >();
  private readonly publicationTimestamps = new Map<string, number[]>();
  private readonly publicationLocks = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    private readonly cacheService: CacheService,
    private readonly quotaService: SignalQuotaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Configure publication limits for a provider. Falls back to defaults.
   */
  setPublicationLimits(
    providerId: string,
    limits: Partial<SignalPublicationLimits>,
  ): SignalPublicationLimits {
    const merged: SignalPublicationLimits = {
      ...DEFAULT_SIGNAL_PUBLICATION_LIMITS,
      ...this.publicationLimits.get(providerId),
      ...limits,
    };
    this.publicationLimits.set(providerId, merged);
    return merged;
  }

  getPublicationLimits(providerId: string): SignalPublicationLimits {
    return (
      this.publicationLimits.get(providerId) ?? {
        ...DEFAULT_SIGNAL_PUBLICATION_LIMITS,
      }
    );
  }

  /**
   * Suspend a provider. Requires an authorized actor and a reason.
   * The transition is recorded in the audit log.
   */
  async suspendProvider(
    providerId: string,
    actorId: string,
    reason: string,
  ): Promise<ProviderSuspension> {
    if (!providerId || !actorId) {
      throw new BadRequestException('providerId and actorId are required');
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A reason is required to suspend a provider');
    }

    const existing = this.suspensions.get(providerId);
    if (existing?.suspended) {
      throw new ConflictException('Provider is already suspended');
    }

    const now = new Date();
    const suspension: ProviderSuspension = {
      providerId,
      suspended: true,
      reason: reason.trim(),
      actorId,
      suspendedAt: now,
      liftedAt: null,
    };
    this.suspensions.set(providerId, suspension);
    this.recordSuspensionAudit({
      providerId,
      action: 'suspend',
      actorId,
      reason: suspension.reason,
      timestamp: now,
    });
    this.emitSafely('provider.suspended', suspension);
    return suspension;
  }

  /**
   * Lift a provider suspension. Requires an authorized actor.
   * The transition is recorded in the audit log.
   */
  async unsuspendProvider(
    providerId: string,
    actorId: string,
    reason?: string,
  ): Promise<ProviderSuspension> {
    if (!providerId || !actorId) {
      throw new BadRequestException('providerId and actorId are required');
    }

    const existing = this.suspensions.get(providerId);
    if (!existing?.suspended) {
      throw new ConflictException('Provider is not currently suspended');
    }

    const now = new Date();
    const suspension: ProviderSuspension = {
      ...existing,
      suspended: false,
      liftedAt: now,
    };
    this.suspensions.set(providerId, suspension);
    this.recordSuspensionAudit({
      providerId,
      action: 'unsuspend',
      actorId,
      reason: reason?.trim() || null,
      timestamp: now,
    });
    this.emitSafely('provider.unsuspended', suspension);
    return suspension;
  }

  /**
   * Returns true when the provider is currently suspended.
   */
  isProviderSuspended(providerId: string): boolean {
    return this.suspensions.get(providerId)?.suspended === true;
  }

  /**
   * Returns the audit trail of suspension transitions.
   */
  getSuspensionAudit(providerId?: string): SuspensionAuditEntry[] {
    if (!providerId) return [...this.suspensionAudit];
    return this.suspensionAudit.filter((e) => e.providerId === providerId);
  }

  private recordSuspensionAudit(entry: SuspensionAuditEntry): void {
    this.suspensionAudit.push(entry);
    this.logger.log(
      `Provider ${entry.providerId} ${entry.action} by ${entry.actorId}` +
        (entry.reason ? `: ${entry.reason}` : ''),
    );
  }

  /**
   * Guard used by follower-acceptance flows. Throws when the provider is
   * suspended so it cannot accept new followers.
   */
  assertProviderCanAcceptFollowers(providerId: string): void {
    if (this.isProviderSuspended(providerId)) {
      throw new ForbiddenException(
        'Suspended providers cannot accept new followers',
      );
    }
  }

  /**
   * Serialize publication-limit checks per provider so the check-and-consume
   * step is atomic (no race between concurrent publishes).
   */
  private async withPublicationLock<T>(
    providerId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = this.publicationLocks.get(providerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.publicationLocks.set(
      providerId,
      previous.then(() => current),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.publicationLocks.get(providerId) === current) {
        this.publicationLocks.delete(providerId);
      }
    }
  }

  /**
   * Atomically enforce publication limits for a provider and record the
   * publication. Throws ForbiddenException identifying the exceeded limit.
   */
  private async enforcePublicationLimits(providerId: string): Promise<void> {
    await this.withPublicationLock(providerId, async () => {
      const limits = this.getPublicationLimits(providerId);
      const now = Date.now();

      const timestamps = (this.publicationTimestamps.get(providerId) ?? [])
        .filter((ts) => now - ts < limits.windowMs);

      if (timestamps.length >= limits.maxSignalsPerWindow) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          limit: 'frequency' as SignalPublicationLimitType,
          message: `Signal publication frequency limit exceeded: max ${limits.maxSignalsPerWindow} signals per ${limits.windowMs}ms`,
          maxSignalsPerWindow: limits.maxSignalsPerWindow,
          windowMs: limits.windowMs,
        });
      }

      const activeCount = await this.signalRepository.count({
        where: { providerId, status: SignalStatus.ACTIVE },
      });

      if (activeCount >= limits.maxActiveSignals) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          limit: 'active_signals' as SignalPublicationLimitType,
          message: `Outstanding active signal limit exceeded: max ${limits.maxActiveSignals} active signals`,
          maxActiveSignals: limits.maxActiveSignals,
        });
      }

      timestamps.push(now);
      this.publicationTimestamps.set(providerId, timestamps);
    });
  }

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

    // Suspended providers cannot create new signals
    if (this.isProviderSuspended(createSignalDto.providerId)) {
      throw new ForbiddenException(
        'Suspended providers cannot create new signals',
      );
    }

    // Enforce quota — throws ForbiddenException when exceeded
    await this.quotaService.checkAndConsume(
      createSignalDto.providerId,
      createSignalDto.tier ?? 'basic',
      createSignalDto.isStaked ?? false,
    );

    // Enforce publication limits atomically — throws ForbiddenException
    // identifying the applicable limit when exceeded
    await this.enforcePublicationLimits(createSignalDto.providerId);

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
      return { id, timestamp: Number(timestamp) };
    } catch {
      throw new BadRequestException('Invalid pagination cursor');
    }
  }

  private emitSafely(event: string, payload: unknown): void {
    try {
      this.eventEmitter.emit(event, payload);
    } catch (err) {
      this.logger.warn(
        `Failed to emit ${event}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
