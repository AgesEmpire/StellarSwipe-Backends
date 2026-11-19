import { Injectable } from '@nestjs/common';
import { TaxReportQueryDto } from './dto/tax-report-query.dto';
import { TaxReportResultDto } from './dto/tax-report-result.dto';
import { CapitalGainsCalculator } from './calculators/capital-gains.calculator';
import { IRSForm8949Formatter } from './formatters/irs-form-8949.formatter';
import { PdfReportFormatter } from './formatters/pdf-report.formatter';
import { TaxReportConfigurationService } from './tax-report-configuration.service';
import { TaxLedgerRepository } from './tax-ledger.repository';

@Injectable()
export class TaxReportService {
  constructor(
    private readonly configurationService: TaxReportConfigurationService,
    private readonly ledgerRepository: TaxLedgerRepository,
  ) {}

  async generateReport(query: TaxReportQueryDto): Promise<TaxReportResultDto> {
    const periodFrom = `${query.taxYear}-01-01`;
    const periodTo = `${query.taxYear + 1}-01-01`;
    const jurisdictionConfiguration =
      this.configurationService.getJurisdictionConfiguration(
        query.jurisdiction,
        periodFrom,
        periodTo,
      );
    const mappingSet = this.configurationService.getMappingSet(
      periodFrom,
      periodTo,
    );
    // Only finalized ledger entries are included; all other states remain excluded.
    const calculator = new CapitalGainsCalculator();
    const report = calculator.calculate(
      query,
      this.ledgerRepository.findBySaleYear(query.taxYear),
      mappingSet.classifications,
      {
        jurisdiction: query.jurisdiction,
        jurisdictionConfigurationVersion: jurisdictionConfiguration.version,
        mappingVersion: mappingSet.version,
        entryPolicy: {
          includedStatuses: ['finalized'],
          excludedStatuses: [
            'pending',
            'reversed',
            'corrected',
            'all other non-final states',
          ],
          rule: 'Only entries with finalized status are reported.',
        },
      },
    );

    let formattedReport;
    if (query.format === 'PDF') {
      formattedReport = await new PdfReportFormatter().format(report, query);
    } else {
      formattedReport = new IRSForm8949Formatter().format(report, query);
    }

    return formattedReport;
  }
}
