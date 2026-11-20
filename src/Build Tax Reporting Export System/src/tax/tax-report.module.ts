import { Module } from '@nestjs/common';
import { TaxReportService } from './tax-report.service';
import { TaxReportController } from './tax-report.controller';
import { TaxReportConfigurationService } from './tax-report-configuration.service';
import { TaxLedgerRepository } from './tax-ledger.repository';

@Module({
  controllers: [TaxReportController],
  providers: [
    TaxReportService,
    TaxReportConfigurationService,
    TaxLedgerRepository,
  ],
  exports: [
    TaxReportService,
    TaxReportConfigurationService,
    TaxLedgerRepository,
  ],
})
export class TaxReportModule {}
