import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { EventEmitterService } from './event-emitter.service';
import { BaseEvent } from './base.event';
import { OutboxEvent } from './entities/outbox-event.entity';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepository: Repository<OutboxEvent>,
    private readonly eventEmitter: EventEmitterService,
  ) {}

  async enqueue(event: BaseEvent, manager?: EntityManager): Promise<OutboxEvent> {
    const repository = manager ? manager.getRepository(OutboxEvent) : this.outboxRepository;
    const outbox = repository.create({
      eventName: event.eventName,
      payload: event,
      metadata: { timestamp: event.timestamp.toISOString() },
      correlationId: event.correlationId,
      attempts: 0,
    });

    return repository.save(outbox);
  }

  async publishPending(limit = 50): Promise<void> {
    const pendingEvents = await this.outboxRepository.find({
      where: { publishedAt: null },
      order: { createdAt: 'ASC' },
      take: limit,
    });

    if (!pendingEvents.length) {
      return;
    }

    for (const eventRow of pendingEvents) {
      try {
        const replayEvent = new ReplayableEvent(
          eventRow.eventName,
          eventRow.payload,
          eventRow.correlationId,
        );

        await this.eventEmitter.emit(replayEvent);

        eventRow.publishedAt = new Date();
        eventRow.attempts = (eventRow.attempts ?? 0) + 1;

        await this.outboxRepository.save(eventRow);
        this.logger.log(`Published outbox event ${eventRow.eventName} (id=${eventRow.id})`);
      } catch (error) {
        eventRow.attempts = (eventRow.attempts ?? 0) + 1;
        await this.outboxRepository.save(eventRow);
        this.logger.error(
          `Outbox publish failed for ${eventRow.eventName} (id=${eventRow.id})`,
          (error as Error).stack,
        );
      }
    }
  }
}

class ReplayableEvent extends BaseEvent {
  readonly eventName: string;

  constructor(eventName: string, payload: unknown, correlationId?: string) {
    super(correlationId);
    this.eventName = eventName;
    Object.assign(this, payload);
  }

  validate(): void {
    return;
  }
}
