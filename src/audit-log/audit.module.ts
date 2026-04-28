import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditLoggingInterceptor } from './interceptors/audit-logging.interceptor';
import { ComplianceAuditLogger } from './compliance-audit.logger';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    ScheduleModule.forRoot(),
  ],
  controllers: [AuditController],
  providers: [AuditService, AuditLoggingInterceptor, ComplianceAuditLogger],
  exports: [AuditService, AuditLoggingInterceptor, ComplianceAuditLogger],
})
export class AuditModule {}
