import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './preferences/entities/notification-preference.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { UserConsent } from './entities/user-consent.entity';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';
import { PreferencesService } from './preferences/preferences.service';
import { PreferencesController } from './preferences/preferences.controller';
import { NotificationPreferencesService } from './preferences/notification-preferences.service';
import { PreferenceController } from './preferences/preference.controller';
import { NotificationService, NOTIFICATION_QUEUE } from './notification.service';
import { NotificationsService } from './notifications.service';
import { NotificationController } from './notification.controller';
import { NotificationProcessor } from './notification.processor';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationTcpController } from './notification-tcp.controller';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationPreference, NotificationTemplate, UserConsent]),
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
    JobsModule,
  ],
  controllers: [NotificationController, PreferencesController, PreferenceController, NotificationTcpController, ConsentController],
  providers: [NotificationService, NotificationsService, PreferencesService, NotificationPreferencesService, NotificationProcessor, NotificationTemplateService, ConsentService],
  exports: [NotificationService, NotificationsService, PreferencesService, NotificationPreferencesService, NotificationTemplateService, ConsentService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(private readonly templateService: NotificationTemplateService) {}

  async onModuleInit() {
    // Ensure default templates exist on startup
    await this.templateService.ensureDefaultTemplates();
  }
}


