import { BadRequestException } from '@nestjs/common';
import { TaxReportQueryDto } from './dto/tax-report-query.dto';
import { TaxReportConfigurationService } from './tax-report-configuration.service';
import { TaxLedgerRepository } from './tax-ledger.repository';
import { TaxReportService } from './tax-report.service';
import { LedgerEntryStatus, TaxLedgerEntry } from './tax-report.types';

describe('TaxReportService', () => {
  let configuration: TaxReportConfigurationService;
  let ledger: TaxLedgerRepository;
  let service: TaxReportService;

  const query = (taxYear: number): TaxReportQueryDto => ({
    taxYear,
    method: 'FIFO',
    jurisdiction: 'US',
  });

  const entry = (
    id: string,
    status: LedgerEntryStatus,
    taxYear = 2024,
    costBasis = 100,
    proceeds = 125,
  ): TaxLedgerEntry => ({
    id,
    status,
    dateAcquired: new Date(`${taxYear}-01-01T00:00:00.000Z`),
    dateSold: new Date(`${taxYear}-02-01T00:00:00.000Z`),
    asset: 'XLM',
    quantity: 10,
    costBasis,
    proceeds,
    term: 'short',
  });

  beforeEach(() => {
    configuration = new TaxReportConfigurationService();
    ledger = new TaxLedgerRepository();
    service = new TaxReportService(configuration, ledger);
    configuration.addJurisdictionConfiguration({
      jurisdiction: 'US',
      version: 'us-2024-v1',
      effectiveFrom: '2024-01-01',
      effectiveTo: '2025-01-01',
    });
    configuration.addMappingSet({
      version: 'mapping-2024-v1',
      effectiveFrom: '2024-01-01',
      effectiveTo: '2025-01-01',
      classifications: { XLM: 'digital-asset-v1' },
    });
  });

  it('includes only finalized entries and documents excluded states', async () => {
    [
      entry('finalized', 'finalized'),
      entry('pending', 'pending'),
      entry('reversed', 'reversed'),
      entry('corrected-original', 'corrected', 2024, 100, 1000),
      entry('corrected-replacement', 'finalized', 2024, 100, 110),
    ].forEach(item => ledger.save(item));
    const report = await service.generateReport(query(2024));

    expect(report.transactions.map(transaction => transaction.ledgerEntryId)).toEqual([
      'corrected-replacement',
      'finalized',
    ]);
    expect(report.metadata.entryPolicy.includedStatuses).toEqual(['finalized']);
    expect(report.metadata.entryPolicy.excludedStatuses).toContain('pending');
    expect(report.metadata.entryPolicy.excludedStatuses).toContain('reversed');
    expect(report.metadata.entryPolicy.excludedStatuses).toContain('corrected');
  });

  it('selects effective jurisdiction and mapping versions per reporting year', async () => {
    configuration.addJurisdictionConfiguration({
      jurisdiction: 'US',
      version: 'us-2025-v1',
      effectiveFrom: '2025-01-01',
      effectiveTo: '2026-01-01',
    });
    configuration.addMappingSet({
      version: 'mapping-2025-v2',
      effectiveFrom: '2025-01-01',
      effectiveTo: '2026-01-01',
      classifications: { XLM: 'digital-asset-v2' },
    });

    ledger.save(entry('old-rule', 'finalized', 2024));
    ledger.save(entry('new-rule', 'finalized', 2025));
    const oldReport = await service.generateReport(query(2024));
    const newReport = await service.generateReport(query(2025));

    expect(oldReport.metadata.mappingVersion).toBe('mapping-2024-v1');
    expect(oldReport.transactions[0].classification).toBe('digital-asset-v1');
    expect(newReport.metadata.mappingVersion).toBe('mapping-2025-v2');
    expect(newReport.transactions[0].classification).toBe('digital-asset-v2');
  });

  it('rejects invalid effective dates and overlapping configurations', () => {
    expect(() =>
      configuration.addJurisdictionConfiguration({
        jurisdiction: 'US',
        version: 'invalid',
        effectiveFrom: '2024-02-31',
        effectiveTo: '2025-01-01',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      configuration.addJurisdictionConfiguration({
        jurisdiction: 'US',
        version: 'overlapping',
        effectiveFrom: '2024-06-01',
        effectiveTo: '2025-06-01',
      }),
    ).toThrow(BadRequestException);
  });
});
