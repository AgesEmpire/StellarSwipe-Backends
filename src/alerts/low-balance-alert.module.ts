import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { LowBalanceAlertService } from './low-balance-alert.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CacheModule } from '../cache/cache.module';
import { StellarModule } from '../stellar/stellar.module';
import { User } from '../users/entities/user.entity';
import { LowBalanceAlertJob } from './low-balance-alert.job';

@Module({
  imports: [TypeOrmModule.forFeature([User]), ScheduleModule.forRoot(), NotificationsModule, CacheModule, StellarModule],
  providers: [LowBalanceAlertService, LowBalanceAlertJob],
  exports: [LowBalanceAlertService],
})
export class LowBalanceAlertModule {}
