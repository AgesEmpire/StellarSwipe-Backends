import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { User } from '../users/entities/user.entity';
import { Signal } from '../signals/entities/signal.entity';
import { ListUsersCommand } from './commands/users/list-users.command';
import { SuspendUserCommand } from './commands/users/suspend-user.command';
import { ExportUserDataCommand } from './commands/users/export-user-data.command';
import { ModerateSignalCommand } from './commands/signals/moderate-signal.command';
import { FlagSignalCommand } from './commands/signals/flag-signal.command';
import { ClearCacheCommand } from './commands/maintenance/clear-cache.command';
import { MigrateDataCommand } from './commands/maintenance/migrate-data.command';
import { ReindexSearchCommand } from './commands/maintenance/reindex-search.command';
import { GenerateReportCommand } from './commands/analytics/generate-report.command';

@Module({
  imports: [
    ConfigModule,
    CacheModule.register(),
    TypeOrmModule.forFeature([User, Signal]),
  ],
  providers: [
    ListUsersCommand,
    SuspendUserCommand,
    ExportUserDataCommand,
    ModerateSignalCommand,
    FlagSignalCommand,
    ClearCacheCommand,
    MigrateDataCommand,
    ReindexSearchCommand,
    GenerateReportCommand,
  ],
  exports: [
    ListUsersCommand,
    SuspendUserCommand,
    ExportUserDataCommand,
    ModerateSignalCommand,
    FlagSignalCommand,
    ClearCacheCommand,
    MigrateDataCommand,
    ReindexSearchCommand,
    GenerateReportCommand,
  ],
})
export class CliModule {}
