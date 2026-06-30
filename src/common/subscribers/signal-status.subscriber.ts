import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Signal } from '../signals/entities/signal.entity';
import { SignalStatusTransitionEvent } from '../events/signal-status-transition.event';

@Injectable()
export class SignalStatusSubscriber implements EntitySubscriberInterface<Signal> {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Signal;
  }

  afterUpdate(event: UpdateEvent<Signal>): void {
    const prev = event.databaseEntity;
    const next = event.entity;

    if (!prev || !next || prev.status === next.status) return;

    const domainEvent = new SignalStatusTransitionEvent(
      next.id ?? prev.id,
      prev.status,
      next.status,
    );

    this.eventEmitter.emit(domainEvent.eventName, domainEvent);
  }
}
