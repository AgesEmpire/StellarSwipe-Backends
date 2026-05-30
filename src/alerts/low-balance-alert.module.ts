import { Module } from '@nestjs/common';
import { LowBalanceAlertService } from './low-balance-alert.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [LowBalanceAlertService],
  exports: [LowBalanceAlertService],
})
export class LowBalanceAlertModule {}
