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

  /** Observability: counts per status plus age of the oldest pending event. */
  async stats() {
    const rows: { status: OutboxStatus; count: string }[] = await this.dataSource
      .getRepository(OutboxEvent)
      .createQueryBuilder('e')
      .select('e.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('e.status')
      .getRawMany();
    const oldest = await this.dataSource.getRepository(OutboxEvent).findOne({
      where: { status: OutboxStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
    return {
      counts: Object.fromEntries(rows.map((r) => [r.status, Number(r.count)])),
      oldestPendingAgeMs: oldest ? Date.now() - oldest.createdAt.getTime() : 0,
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
