import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProvidersController } from './providers.controller';
import { StakeVerificationService } from './stake-verification.service';
import { StakeVerificationAlertService } from './stake-verification-alert.service';
import { VerificationMonitorJob } from './verification-monitor.job';

@Module({
  imports: [
    ConfigModule,
    CacheModule.register({
      ttl: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
      max: 1000, // Maximum number of items in cache
    }),
    NotificationsModule,
  ],
  controllers: [ProvidersController],
  providers: [
    StakeVerificationService,
    StakeVerificationAlertService,
    VerificationMonitorJob,
  ],
  exports: [
    StakeVerificationService,
    StakeVerificationAlertService,
    VerificationMonitorJob,
  ],
})
export class ProvidersModule {}
