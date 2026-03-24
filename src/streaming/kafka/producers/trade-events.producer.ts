import { Injectable } from '@nestjs/common';
import { KafkaService } from '../kafka.service';
import { KafkaTopics } from '../topics/kafka.topics';

export interface TradeExecutedPayload {
  tradeId: string;
  userId: string;
  assetPair: string;
  amount: number;
  price: number;
  executedAt: Date;
}

export interface TradeCancelledPayload {
  tradeId: string;
  userId: string;
  reason?: string;
  cancelledAt: Date;
}

export interface TradeScheduledPayload {
  scheduleId: string;
  userId: string;
  assetPair: string;
  amount: number;
  scheduledAt: Date;
}

@Injectable()
export class TradeEventsProducer {
  constructor(private readonly kafkaService: KafkaService) {}

  emitTradeExecuted(payload: TradeExecutedPayload): void {
    this.kafkaService.emit(KafkaTopics.TRADE_EXECUTED, {
      key: payload.tradeId,
      value: payload,
      timestamp: new Date(),
    });
  }

  emitTradeCancelled(payload: TradeCancelledPayload): void {
    this.kafkaService.emit(KafkaTopics.TRADE_CANCELLED, {
      key: payload.tradeId,
      value: payload,
      timestamp: new Date(),
    });
  }

  emitTradeScheduled(payload: TradeScheduledPayload): void {
    this.kafkaService.emit(KafkaTopics.TRADE_SCHEDULED, {
      key: payload.scheduleId,
      value: payload,
      timestamp: new Date(),
    });
  }
}
