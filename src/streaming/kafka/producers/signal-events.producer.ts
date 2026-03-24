import { Injectable } from '@nestjs/common';
import { KafkaService } from '../kafka.service';
import { KafkaTopics } from '../topics/kafka.topics';

export interface SignalCreatedPayload {
  signalId: string;
  providerId: string;
  assetPair: string;
  action: string;
  targetPrice: number;
  createdAt: Date;
}

export interface SignalExpiredPayload {
  signalId: string;
  providerId: string;
  expiredAt: Date;
}

export interface SignalTriggeredPayload {
  signalId: string;
  userId: string;
  triggeredAt: Date;
}

@Injectable()
export class SignalEventsProducer {
  constructor(private readonly kafkaService: KafkaService) {}

  emitSignalCreated(payload: SignalCreatedPayload): void {
    this.kafkaService.emit(KafkaTopics.SIGNAL_CREATED, {
      key: payload.signalId,
      value: payload,
      timestamp: new Date(),
    });
  }

  emitSignalExpired(payload: SignalExpiredPayload): void {
    this.kafkaService.emit(KafkaTopics.SIGNAL_EXPIRED, {
      key: payload.signalId,
      value: payload,
      timestamp: new Date(),
    });
  }

  emitSignalTriggered(payload: SignalTriggeredPayload): void {
    this.kafkaService.emit(KafkaTopics.SIGNAL_TRIGGERED, {
      key: payload.signalId,
      value: payload,
      timestamp: new Date(),
    });
  }
}
