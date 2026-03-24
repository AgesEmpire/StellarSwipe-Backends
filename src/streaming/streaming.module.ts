import { Module } from '@nestjs/common';
import { KafkaService } from './kafka/kafka.service';
import { TradeEventsProducer } from './kafka/producers/trade-events.producer';
import { SignalEventsProducer } from './kafka/producers/signal-events.producer';
import { TradeEventsConsumer } from './kafka/consumers/trade-events.consumer';
import { SignalEventsConsumer } from './kafka/consumers/signal-events.consumer';

@Module({
  providers: [
    KafkaService,
    TradeEventsProducer,
    SignalEventsProducer,
    TradeEventsConsumer,
    SignalEventsConsumer,
  ],
  exports: [KafkaService, TradeEventsProducer, SignalEventsProducer],
})
export class StreamingModule {}
