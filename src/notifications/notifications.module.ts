import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './preferences/entities/notification-preference.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { PreferencesService } from './preferences/preferences.service';
import { PreferencesController } from './preferences/preferences.controller';
import { NotificationPreferencesService } from './preferences/notification-preferences.service';
import { PreferenceController } from './preferences/preference.controller';
import { NotificationService, NOTIFICATION_QUEUE } from './notification.service';
import { NotificationsService } from './notifications.service';
import { NotificationController } from './notification.controller';
import { NotificationProcessor } from './notification.processor';
import { NotificationTemplateService } from './notification-template.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationPreference, NotificationTemplate]),
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationController, PreferencesController, PreferenceController],
  providers: [NotificationService, NotificationsService, PreferencesService, NotificationPreferencesService, NotificationProcessor, NotificationTemplateService],
  exports: [NotificationService, NotificationsService, PreferencesService, NotificationPreferencesService, NotificationTemplateService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(private readonly templateService: NotificationTemplateService) {}

  async onModuleInit() {
    // Ensure default templates exist on startup
    await this.templateService.ensureDefaultTemplates();
  }
}


