import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OutboxEvent, OutboxEventStatus } from './outbox-event.entity';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 5_000;
// Rows stuck in PROCESSING longer than this are assumed to belong to a crashed
// relay instance and are picked back up (at-least-once, not exactly-once).
const STALE_PROCESSING_MS = 2 * 60 * 1000;

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepository: Repository<OutboxEvent>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async relay(): Promise<void> {
    const rows = await this.claimBatch();
    if (rows.length === 0) return;

    for (const row of rows) {
      await this.publishOne(row);
    }
  }

  /**
   * Locks a batch of due rows with SELECT ... FOR UPDATE SKIP LOCKED so multiple
   * relay instances can run concurrently without double-publishing the same row.
   */
  private async claimBatch(): Promise<OutboxEvent[]> {
    return this.dataSource.transaction(async (manager) => {
      const staleSince = new Date(Date.now() - STALE_PROCESSING_MS);

      const rows = await manager
        .createQueryBuilder(OutboxEvent, 'outbox')
        .where('outbox.status = :pending AND outbox.next_attempt_at <= NOW()', {
          pending: OutboxEventStatus.PENDING,
        })
        .orWhere('outbox.status = :processing AND outbox.updated_at <= :staleSince', {
          processing: OutboxEventStatus.PROCESSING,
          staleSince,
        })
        .orderBy('outbox.created_at', 'ASC')
        .limit(BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      if (rows.length === 0) return [];

      await manager.update(
        OutboxEvent,
        rows.map((row) => row.id),
        { status: OutboxEventStatus.PROCESSING },
      );

      return rows;
    });
  }

  private async publishOne(row: OutboxEvent): Promise<void> {
    try {
      await this.eventEmitter.emitAsync(row.eventType, row.payload);
      await this.outboxRepository.update(row.id, {
        status: OutboxEventStatus.PUBLISHED,
        publishedAt: new Date(),
      });
    } catch (error) {
      const attempts = row.attempts + 1;
      const isExhausted = attempts >= MAX_ATTEMPTS;

      this.logger.error(
        `Failed to publish outbox event ${row.id} (${row.eventType}), attempt ${attempts}`,
        error?.stack,
      );

      await this.outboxRepository.update(row.id, {
        status: isExhausted ? OutboxEventStatus.FAILED : OutboxEventStatus.PENDING,
        attempts,
        lastError: String(error?.message || error),
        nextAttemptAt: new Date(Date.now() + BACKOFF_BASE_MS * 2 ** attempts),
      });
    }
  }
}
