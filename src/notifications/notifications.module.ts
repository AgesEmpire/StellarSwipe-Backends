import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationPreference } from './preferences/entities/notification-preference.entity';
import { PreferencesService } from './preferences/preferences.service';
import { PreferencesController } from './preferences/preferences.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationPreference])],
  controllers: [PreferencesController],
  providers: [PreferencesService],
  exports: [PreferencesService], // export so other modules can call isEnabled() before sending
})
export class NotificationsModule {}
