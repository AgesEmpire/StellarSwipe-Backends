import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { GeoBlockService } from './geo-blocking/geo-block.service';
import { SanctionsScreeningService } from './geo-blocking/sanctions-screening.service';
import { GeoBlockMiddleware } from './geo-blocking/middleware/geo-block.middleware';
import { ComplianceReportingService } from './compliance-reporting.service';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceLog } from './entities/compliance-log.entity';
import { SuspiciousActivity } from './aml/entities/suspicious-activity.entity';
import { AmlMonitoringService } from './aml/aml-monitoring.service';
import { PatternDetectionService } from './aml/pattern-detection.service';
import { AmlScanJob, AML_QUEUE } from './aml/jobs/aml-scan.job';
import { Trade } from '../trades/entities/trade.entity';
import { User } from '../users/entities/user.entity';
import { Signal } from '../signals/entities/signal.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { UserDataExporterService } from './exporters/user-data-exporter.service';
import { TradeReportExporterService } from './exporters/trade-report-exporter.service';
import { AuditTrailExporterService } from './exporters/audit-trail-exporter.service';
import { GdprReportGenerator } from './reports/gdpr-report.generator';
import { FinancialReportGenerator } from './reports/financial-report.generator';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([ComplianceLog, SuspiciousActivity, Trade, User, Signal, AuditLog]),
    BullModule.registerQueue({ name: AML_QUEUE }),
  ],
  providers: [
    GeoBlockService,
    SanctionsScreeningService,
    ComplianceReportingService,
    ComplianceService,
    AmlMonitoringService,
    PatternDetectionService,
    AmlScanJob,
    UserDataExporterService,
    TradeReportExporterService,
    AuditTrailExporterService,
    GdprReportGenerator,
    FinancialReportGenerator,
  ],
  controllers: [ComplianceController],
  exports: [
    GeoBlockService,
    SanctionsScreeningService,
    ComplianceReportingService,
    ComplianceService,
    AmlMonitoringService,
  ],
})
export class ComplianceModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(GeoBlockMiddleware)
      .exclude('health', 'health/(.*)')
      .forRoutes('*');
  }
}
