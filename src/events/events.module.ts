import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventEmitterService } from './event-emitter.service';
import { EventReplayService } from './event-replay.service';
import { EventSerializerService } from './event-serializer';
import { TradeEventListener } from './listeners/trade-event.listener';
import { SignalEventListener } from './listeners/signal-event.listener';
import { PortfolioEventListener } from './listeners/portfolio-event.listener';
import { ReferralEventListener } from './referral-event.listener';
import { ReferralsModule } from '../referrals/referrals.module';
import { AuditLog } from '../audit-log/entities/audit-log.entity';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      global: true,
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
    TypeOrmModule.forFeature([AuditLog]),
    ReferralsModule,
  ],
  providers: [
    EventEmitterService,
    EventReplayService,
    EventSerializerService,
    TradeEventListener,
    SignalEventListener,
    PortfolioEventListener,
    ReferralEventListener,
  ],
  exports: [EventEmitterService, EventReplayService, EventSerializerService],
})
export class EventsModule {}