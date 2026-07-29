import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { UserSettings } from './entities/user-settings.entity';
import { AuditModule } from '../audit-log/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSettings]),
    CacheModule.register({
      ttl: 300000,
      max: 1000,
    }),
    AuditModule,
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
