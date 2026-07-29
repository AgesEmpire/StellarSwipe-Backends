import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepository: Repository<OutboxEvent>,
  ) {}

  /**
   * Persist a domain event to the outbox. Pass the same `EntityManager` used for the
   * triggering mutation (e.g. from a QueryRunner transaction) so the event is written
   * atomically with the write it describes — the whole point of the outbox pattern.
   */
  async record(
    manager: EntityManager,
    eventType: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void> {
    const repository = manager.getRepository(OutboxEvent);

    if (idempotencyKey) {
      const result = await repository
        .createQueryBuilder()
        .insert()
        .values({ eventType, payload, idempotencyKey })
        .orIgnore()
        .execute();

      if (result.identifiers.length === 0) {
        this.logger.debug(
          `Skipped duplicate outbox event for idempotency key ${idempotencyKey}`,
        );
      }
      return;
    }

    await repository.insert({ eventType, payload });
  }
}
