import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, In } from 'typeorm';
import { OutboxEvent, OutboxStatus } from './outbox-event.entity';

export interface OutboxMessage {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/** Broker abstraction; bind OUTBOX_BROKER to Kafka/SQS/etc. Defaults to the in-process emitter. */
export interface OutboxBroker {
  publish(event: OutboxEvent): Promise<void>;
}
export const OUTBOX_BROKER = Symbol('OUTBOX_BROKER');

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 10);

/** Controlled event-type registry: any other type is reported as `other` so metric cardinality stays bounded. */
export const OUTBOX_EVENT_TYPE_REGISTRY = [
  'trade.order.created',
  'trade.execution.failed',
  'trade.completed',
  'trade.position.closed',
  'conditional_order.cancelled',
  'conditional_order.filled',
  'conditional_order.triggered',
  'stellar.transaction.confirmed',
] as const;
const OTHER_EVENT_TYPE = 'other';

type BacklogState = 'pending' | 'retrying' | 'exhausted';
type BacklogBucket = { count: number; oldestAgeMs: number };

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() @Inject(OUTBOX_BROKER) private readonly broker?: OutboxBroker,
    @Optional() private readonly emitter?: EventEmitter2,
  ) {}

  /**
   * Stage an event using the caller's transaction manager so it commits
   * (or rolls back) atomically with the business data.
   */
  enqueue(manager: EntityManager, message: OutboxMessage): Promise<OutboxEvent> {
    return manager.save(manager.create(OutboxEvent, message));
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async publishPending(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.dataSource.transaction(async (manager) => {
        // SKIP LOCKED lets multiple instances publish in parallel without double-sending.
        const events = await manager
          .getRepository(OutboxEvent)
          .createQueryBuilder('e')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('e.status = :status', { status: OutboxStatus.PENDING })
          .andWhere('e.next_attempt_at <= now()')
          .orderBy('e.created_at', 'ASC')
          .limit(BATCH_SIZE)
          .getMany();

        for (const event of events) {
          try {
            await this.send(event);
            event.status = OutboxStatus.PUBLISHED;
            event.publishedAt = new Date();
            event.lastError = null;
          } catch (err) {
            event.attempts += 1;
            event.lastError = (err as Error).message;
            if (event.attempts >= MAX_ATTEMPTS) {
              event.status = OutboxStatus.DEAD;
              this.logger.error(`Outbox event ${event.id} moved to DEAD: ${event.lastError}`);
            } else {
              const delayMs = Math.min(2 ** event.attempts * 1000, 15 * 60_000);
              event.nextAttemptAt = new Date(Date.now() + delayMs);
              this.logger.warn(`Outbox event ${event.id} publish failed (attempt ${event.attempts})`);
            }
          }
          await manager.save(event);
        }
        return events.length;
      });
    } finally {
      this.running = false;
    }
  }

  /**
   * Observability: counts per status, age of the oldest pending event, and per-event-type
   * backlog split into pending / retrying / exhausted (DEAD) with count and oldest age.
   * Only event type and state are exposed; no aggregate, tenant or user identifiers.
   */
  async stats() {
    const repository = this.dataSource.getRepository(OutboxEvent);
    const rows: { status: OutboxStatus; count: string }[] = await repository
      .createQueryBuilder('e')
      .select('e.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('e.status')
      .getRawMany();
    const oldest = await repository.findOne({
      where: { status: OutboxStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
    const backlogRows: {
      eventType: string;
      status: OutboxStatus;
      attempts: number;
      count: string;
      oldest: Date;
    }[] = await repository
      .createQueryBuilder('e')
      .select('e.eventType', 'eventType')
      .addSelect('e.status', 'status')
      .addSelect('e.attempts', 'attempts')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MIN(e.createdAt)', 'oldest')
      .where('e.status IN (:...statuses)', { statuses: [OutboxStatus.PENDING, OutboxStatus.DEAD] })
      .groupBy('e.eventType')
      .addGroupBy('e.status')
      .addGroupBy('e.attempts')
      .getRawMany();

    const now = Date.now();
    const backlogByEventType: Record<string, Record<BacklogState, BacklogBucket>> = Object.fromEntries(
      [...OUTBOX_EVENT_TYPE_REGISTRY, OTHER_EVENT_TYPE].map((type) => [
        type,
        {
          pending: { count: 0, oldestAgeMs: 0 },
          retrying: { count: 0, oldestAgeMs: 0 },
          exhausted: { count: 0, oldestAgeMs: 0 },
        },
      ]),
    );
    for (const row of backlogRows) {
      const type = (OUTBOX_EVENT_TYPE_REGISTRY as readonly string[]).includes(row.eventType)
        ? row.eventType
        : OTHER_EVENT_TYPE;
      const state: BacklogState =
        row.status === OutboxStatus.DEAD ? 'exhausted' : Number(row.attempts) > 0 ? 'retrying' : 'pending';
      const bucket = backlogByEventType[type][state];
      bucket.count += Number(row.count);
      bucket.oldestAgeMs = Math.max(bucket.oldestAgeMs, now - new Date(row.oldest).getTime());
    }

    return {
      counts: Object.fromEntries(rows.map((r) => [r.status, Number(r.count)])),
      oldestPendingAgeMs: oldest ? now - oldest.createdAt.getTime() : 0,
      backlogByEventType,
    };
  }

  /** Recovery: requeue DEAD (or specific) events for another publish cycle. */
  async replay(ids?: string[]): Promise<number> {
    const result = await this.dataSource.getRepository(OutboxEvent).update(
      ids?.length ? { id: In(ids) } : { status: OutboxStatus.DEAD },
      { status: OutboxStatus.PENDING, attempts: 0, nextAttemptAt: new Date(), lastError: null },
    );
    return result.affected ?? 0;
  }

  private async send(event: OutboxEvent): Promise<void> {
    if (this.broker) return this.broker.publish(event);
    if (!this.emitter) throw new Error('No outbox broker configured');
    // Consumers must be idempotent on event.id (at-least-once delivery).
    await this.emitter.emitAsync(event.eventType, { id: event.id, ...event.payload });
  }
}
