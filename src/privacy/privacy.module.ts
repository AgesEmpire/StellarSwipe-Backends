import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { RetentionPurgeService } from './retention-purge.service';
import { SoftDeleteAuditService } from './soft-delete-audit.service';
import { SoftDeleteAuditJob } from './soft-delete-audit.job';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    ScheduleModule.forRoot(),
  ],
  providers: [
    RetentionPurgeService,
    SoftDeleteAuditService,
    SoftDeleteAuditJob,
  ],
  exports: [
    RetentionPurgeService,
    SoftDeleteAuditService,
  ],
})
export class PrivacyModule {}
