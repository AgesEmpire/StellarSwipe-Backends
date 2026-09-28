import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import { KycVerification } from './entities/kyc-verification.entity';
import { KycAuditLog } from './entities/kyc-audit-log.entity';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { KycGuard } from './kyc.guard';
import { KycEventListener } from './kyc-event.listener';
import { KycExpiryListener } from './kyc-expiry.listener';
import { PersonaProvider } from './providers/persona.provider';
import { OnfidoProvider } from './providers/onfido.provider';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([KycVerification, KycAuditLog]),
    EventEmitterModule,
    ScheduleModule,
    NotificationsModule,
  ],
  controllers: [KycController],
  providers: [
    KycService,
    KycGuard,
    KycEventListener,
    KycExpiryListener,
    PersonaProvider,
    OnfidoProvider,
  ],
  exports: [KycService, KycGuard],
})
export class KycModule {}
