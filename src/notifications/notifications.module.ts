import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './preferences/entities/notification-preference.entity';
import { PreferencesService } from './preferences/preferences.service';
import { PreferencesController } from './preferences/preferences.controller';
import { NotificationService, NOTIFICATION_QUEUE } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationProcessor } from './notification.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationPreference]),
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationController, PreferencesController],
  providers: [NotificationService, PreferencesService, NotificationProcessor],
  exports: [NotificationService, PreferencesService],
})
export class NotificationsModule {}
