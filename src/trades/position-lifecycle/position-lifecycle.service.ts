import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, Repository } from 'typeorm';
import { assertOwnership } from '../../authorization/utils/assert-ownership.util';
import {
  PositionLifecycleEvent,
  PositionLifecycleEventType as T,
  PositionLifecycleSource,
} from './position-lifecycle-event.entity';
import { LifecycleBackfill, PositionLifecycleState, deriveState, planTransition } from './position-lifecycle.policy';

/** Reject client-supplied transition times further than this in the future. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const LIFECYCLE_TIMEZONE = 'UTC';

export interface RecordTransitionInput {
  positionId: string;
  userId: string;
  type: T;
  /** Defaults to now. */
  occurredAt?: Date;
  quantityBefore?: string | null;
  quantityAfter?: string | null;
  source: PositionLifecycleSource;
  /** Replays with the same key are no-ops that return the original event. */
  idempotencyKey: string;
  backfill?: LifecycleBackfill;
  metadata?: Record<string, unknown>;
}

export interface RecordTransitionResult {
  event: PositionLifecycleEvent;
  created: boolean;
  inferred: PositionLifecycleEvent[];
}

export interface LifecycleActor {
  id: string;
  roles?: string[];
}

export interface LifecycleEventView {
  id: string;
  positionId: string;
  type: T;
  sequence: number;
  /** ISO 8601, UTC ("Z"). When the transition happened. */
  occurredAt: string;
  /** ISO 8601, UTC ("Z"). When it was persisted. */
  recordedAt: string;
  quantityBefore: string | null;
  quantityAfter: string | null;
  source: PositionLifecycleSource;
  inferred: boolean;
}

export interface LifecycleCycleView {
  openedAt: string;
  openedBy: T.OPENED | T.REOPENED;
  partialCloseAts: string[];
  closedAt: string | null;
}

export interface PositionTimelineView {
  positionId: string;
  userId: string;
  timezone: typeof LIFECYCLE_TIMEZONE;
  state: PositionLifecycleState;
  openedAt: string | null;
  closedAt: string | null;
  archivedAt: string | null;
  cycles: LifecycleCycleView[];
  events: LifecycleEventView[];
}

export interface LifecycleHistoryQuery {
  from?: Date;
  to?: Date;
  types?: T[];
  limit?: number;
}

const iso = (d: Date | string) => new Date(d).toISOString();

export function toEventView(e: PositionLifecycleEvent): LifecycleEventView {
  return {
    id: e.id,
    positionId: e.positionId,
    type: e.eventType,
    sequence: e.sequence,
    occurredAt: iso(e.occurredAt),
    recordedAt: iso(e.recordedAt ?? e.occurredAt),
    quantityBefore: e.quantityBefore ?? null,
    quantityAfter: e.quantityAfter ?? null,
    source: e.source,
    inferred: !!e.inferred,
  };
}

/** Pure: groups an ordered event list into open→close cycles. */
export function buildTimeline(positionId: string, events: PositionLifecycleEvent[]): PositionTimelineView {
  const cycles: LifecycleCycleView[] = [];
  let current: LifecycleCycleView | null = null;
  let archivedAt: string | null = null;
  for (const e of events) {
    const at = iso(e.occurredAt);
    switch (e.eventType) {
      case T.OPENED:
      case T.REOPENED:
        current = { openedAt: at, openedBy: e.eventType, partialCloseAts: [], closedAt: null };
        cycles.push(current);
        break;
      case T.PARTIALLY_CLOSED:
        current?.partialCloseAts.push(at);
        break;
      case T.CLOSED:
        if (current) current.closedAt = at;
        else cycles.push({ openedAt: at, openedBy: T.OPENED, partialCloseAts: [], closedAt: at });
        current = null;
        break;
      case T.ARCHIVED:
        archivedAt = at;
        break;
    }
  }
  const opened = events.find((e) => e.eventType === T.OPENED);
  const lastClose = [...events].reverse().find((e) => e.eventType === T.CLOSED);
  return {
    positionId,
    userId: events[0]?.userId,
    timezone: LIFECYCLE_TIMEZONE,
    state: deriveState(events),
    openedAt: opened ? iso(opened.occurredAt) : null,
    closedAt: lastClose && deriveState(events) !== 'open' ? iso(lastClose.occurredAt) : null,
    archivedAt,
    cycles,
    events: events.map(toEventView),
  };
}

/**
 * Records immutable lifecycle timestamps for portfolio positions (#1534):
 * creation, partial close, full close, reopen and archival.
 */
@Injectable()
export class PositionLifecycleService {
  private readonly logger = new Logger(PositionLifecycleService.name);
  private savepointSeq = 0;

  constructor(
    @InjectRepository(PositionLifecycleEvent)
    private readonly eventRepo: Repository<PositionLifecycleEvent>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Strict: throws on an invalid/out-of-order transition. Pass `manager` to
   * write inside the caller's transaction so the event commits (or rolls
   * back) together with the position change.
   */
  async recordTransition(input: RecordTransitionInput, manager?: EntityManager): Promise<RecordTransitionResult> {
    if (manager) return this.recordWithin(manager, input);
    return this.dataSource.transaction((m) => this.recordWithin(m, input));
  }

  /**
   * For hooks inside existing flows: never breaks the caller. Inside an
   * active transaction the write is wrapped in a SAVEPOINT so a failure here
   * cannot abort the caller's transaction; failures are logged at error level.
   */
  async recordTransitionSafe(input: RecordTransitionInput, manager?: EntityManager): Promise<RecordTransitionResult | null> {
    const qr = manager?.queryRunner;
    if (!manager || !qr?.isTransactionActive) {
      try {
        return await this.recordTransition(input);
      } catch (error) {
        this.logFailure(input, error);
        return null;
      }
    }
    const savepoint = `position_lifecycle_${++this.savepointSeq}`;
    await manager.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await this.recordWithin(manager, input);
      await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      this.logFailure(input, error);
      return null;
    }
  }

  async getTimeline(positionId: string, actor?: LifecycleActor): Promise<PositionTimelineView> {
    const events = await this.eventRepo.find({ where: { positionId }, order: { sequence: 'ASC' } });
    if (!events.length) {
      throw new NotFoundException(`No lifecycle history for position ${positionId}`);
    }
    if (actor) {
      assertOwnership({ requesterId: actor.id, ownerId: events[0].userId, requesterRoles: actor.roles, resource: 'position' });
    }
    return buildTimeline(positionId, events);
  }

  /** Reporting view: a user's transitions with occurredAt in [from, to). */
  async listHistory(userId: string, query: LifecycleHistoryQuery, actor?: LifecycleActor): Promise<LifecycleEventView[]> {
    if (actor) {
      assertOwnership({ requesterId: actor.id, ownerId: userId, requesterRoles: actor.roles, resource: 'positions' });
    }
    const from = query.from ?? new Date(0);
    const to = query.to ?? new Date(Date.now() + MAX_FUTURE_SKEW_MS);
    if (from.getTime() >= to.getTime()) throw new BadRequestException('from must be before to');
    const where: any = { userId, occurredAt: Between(from, new Date(to.getTime() - 1)) };
    if (query.types?.length) where.eventType = In(query.types);
    const events = await this.eventRepo.find({
      where,
      order: { occurredAt: 'ASC', sequence: 'ASC' },
      take: Math.min(Math.max(query.limit ?? 500, 1), 1000),
    });
    return events.map(toEventView);
  }

  private async recordWithin(manager: EntityManager, input: RecordTransitionInput): Promise<RecordTransitionResult> {
    if (!input.positionId || !input.userId || !input.idempotencyKey) {
      throw new BadRequestException('positionId, userId and idempotencyKey are required');
    }
    const now = new Date();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('occurredAt must be a valid date');
    if (occurredAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
      throw new BadRequestException('occurredAt cannot be in the future');
    }

    // Serialize writers for this position (released at transaction end).
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.positionId]);

    const existing = await manager.findOne(PositionLifecycleEvent, { where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { event: existing, created: false, inferred: [] };

    const history = await manager.find(PositionLifecycleEvent, {
      where: { positionId: input.positionId },
      order: { sequence: 'ASC' },
    });
    if (history.length && history[0].userId !== input.userId) {
      throw new ConflictException(`Position ${input.positionId} belongs to another user`);
    }

    const planned = planTransition(
      history.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) })),
      { eventType: input.type, occurredAt },
      input.backfill,
    );

    let sequence = history.length ? history[history.length - 1].sequence : 0;
    const written: PositionLifecycleEvent[] = [];
    for (const p of planned) {
      const row = manager.create(PositionLifecycleEvent, {
        positionId: input.positionId,
        userId: input.userId,
        eventType: p.eventType,
        sequence: ++sequence,
        occurredAt: p.occurredAt,
        quantityBefore: p.inferred ? null : input.quantityBefore ?? null,
        quantityAfter: p.inferred ? null : input.quantityAfter ?? null,
        source: input.source,
        idempotencyKey: p.inferred ? `${input.idempotencyKey}:inferred:${p.eventType}` : input.idempotencyKey,
        inferred: p.inferred,
        metadata: input.metadata ?? null,
      });
      await manager.insert(PositionLifecycleEvent, row);
      written.push(row);
    }
    const event = written[written.length - 1];
    return { event, created: true, inferred: written.slice(0, -1) };
  }

  private logFailure(input: RecordTransitionInput, error: unknown): void {
    this.logger.error(
      `Failed to record ${input.type} for position ${input.positionId} (${input.idempotencyKey}): ${(error as Error)?.message}`,
    );
  }
}
