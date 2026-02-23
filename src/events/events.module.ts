import { Module, Global } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventEmitterService } from './event-emitter.service';
import { TradeEventListener } from './listeners/trade-event.listener';
import { SignalEventListener } from './listeners/signal-event.listener';
import { PortfolioEventListener } from './listeners/portfolio-event.listener';
import { ReferralEventListener } from './referral-event.listener';
import { ReferralsModule } from '../referrals/referrals.module';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      // Use this instance across the entire application
      global: true,
      // Set this to `true` to use wildcards
      wildcard: false,
      // The delimiter used to segment namespaces
      delimiter: '.',
      // Set this to `true` if you want to emit the newListener event
      newListener: false,
      // Set this to `true` if you want to emit the removeListener event
      removeListener: false,
      // The maximum amount of listeners that can be assigned to an event
      maxListeners: 10,
      // Show event name in memory leak message when more than maximum amount of listeners is assigned
      verboseMemoryLeak: true,
      // Disable throwing uncaughtException if an error event is emitted and it has no listeners
      ignoreErrors: false,
    }),
    ReferralsModule,
  ],
  providers: [
    EventEmitterService,
    TradeEventListener,
    SignalEventListener,
    PortfolioEventListener,
    ReferralEventListener,
  ],
  exports: [EventEmitterService],
})
export class EventsModule {}