import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../../audit-log/entities/audit-log.entity';
import { ComplianceExportService } from './compliance-export.service';
import { ComplianceAuditController } from './compliance.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
  ],
  controllers: [ComplianceAuditController],
  providers: [ComplianceExportService],
  exports: [ComplianceExportService],
})
export class ComplianceAuditExportModule {}
