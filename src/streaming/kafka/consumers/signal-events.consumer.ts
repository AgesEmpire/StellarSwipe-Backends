import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KafkaService, KafkaMessage } from '../kafka.service';
import { KafkaTopics } from '../topics/kafka.topics';
import {
  SignalCreatedPayload,
  SignalExpiredPayload,
  SignalTriggeredPayload,
} from '../producers/signal-events.producer';

@Injectable()
export class SignalEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(SignalEventsConsumer.name);
  readonly GROUP_ID = 'signal-events-consumer-group';

  constructor(private readonly kafkaService: KafkaService) {}

  onModuleInit(): void {
    this.kafkaService.subscribe<SignalCreatedPayload>(
      KafkaTopics.SIGNAL_CREATED,
      this.GROUP_ID,
      this.handleSignalCreated.bind(this),
    );
    this.kafkaService.subscribe<SignalExpiredPayload>(
      KafkaTopics.SIGNAL_EXPIRED,
      this.GROUP_ID,
      this.handleSignalExpired.bind(this),
    );
    this.kafkaService.subscribe<SignalTriggeredPayload>(
      KafkaTopics.SIGNAL_TRIGGERED,
      this.GROUP_ID,
      this.handleSignalTriggered.bind(this),
    );
  }

  handleSignalCreated(message: KafkaMessage<SignalCreatedPayload>): void {
    this.logger.log(
      `Signal created: ${message.key} — pair: ${message.value.assetPair}`,
    );
  }

  handleSignalExpired(message: KafkaMessage<SignalExpiredPayload>): void {
    this.logger.log(`Signal expired: ${message.key}`);
  }

  handleSignalTriggered(message: KafkaMessage<SignalTriggeredPayload>): void {
    this.logger.log(
      `Signal triggered: ${message.key} for user: ${message.value.userId}`,
    );
  }
}
