import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';
import { AdvisoryLockModule } from '../../common/database/advisory-lock.module';

@Module({
  imports: [TypeOrmModule.forFeature([]), AdvisoryLockModule],
  providers: [MigrationService],
  controllers: [MigrationController],
  exports: [MigrationService],
})
export class MigrationModule {}