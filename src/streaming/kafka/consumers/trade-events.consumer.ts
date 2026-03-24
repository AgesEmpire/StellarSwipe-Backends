import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KafkaService, KafkaMessage } from '../kafka.service';
import { KafkaTopics } from '../topics/kafka.topics';
import {
  TradeExecutedPayload,
  TradeCancelledPayload,
  TradeScheduledPayload,
} from '../producers/trade-events.producer';

@Injectable()
export class TradeEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(TradeEventsConsumer.name);
  readonly GROUP_ID = 'trade-events-consumer-group';

  constructor(private readonly kafkaService: KafkaService) {}

  onModuleInit(): void {
    this.kafkaService.subscribe<TradeExecutedPayload>(
      KafkaTopics.TRADE_EXECUTED,
      this.GROUP_ID,
      this.handleTradeExecuted.bind(this),
    );
    this.kafkaService.subscribe<TradeCancelledPayload>(
      KafkaTopics.TRADE_CANCELLED,
      this.GROUP_ID,
      this.handleTradeCancelled.bind(this),
    );
    this.kafkaService.subscribe<TradeScheduledPayload>(
      KafkaTopics.TRADE_SCHEDULED,
      this.GROUP_ID,
      this.handleTradeScheduled.bind(this),
    );
  }

  handleTradeExecuted(message: KafkaMessage<TradeExecutedPayload>): void {
    this.logger.log(
      `Trade executed: ${message.key} — pair: ${message.value.assetPair}, amount: ${message.value.amount}`,
    );
  }

  handleTradeCancelled(message: KafkaMessage<TradeCancelledPayload>): void {
    this.logger.log(
      `Trade cancelled: ${message.key} — reason: ${message.value.reason ?? 'none'}`,
    );
  }

  handleTradeScheduled(message: KafkaMessage<TradeScheduledPayload>): void {
    this.logger.log(
      `Trade scheduled: ${message.key} — pair: ${message.value.assetPair}`,
    );
  }
}
