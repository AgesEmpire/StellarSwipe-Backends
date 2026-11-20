export class TaxReportResultDto {
  taxYear: number;
  method: 'FIFO' | 'LIFO';
  transactions: Array<{
    ledgerEntryId: string;
    dateAcquired: Date;
    dateSold: Date;
    asset: string;
    quantity: number;
    costBasis: number;
    proceeds: number;
    gainLoss: number;
    term: 'short' | 'long';
    classification: string;
  }>;
  summary: {
    totalGains: number;
    totalLosses: number;
    netPnL: number;
    shortTermGains: number;
    longTermGains: number;
  };
  metadata: {
    jurisdiction: string;
    jurisdictionConfigurationVersion: string;
    mappingVersion: string;
    entryPolicy: {
      includedStatuses: string[];
      excludedStatuses: string[];
      rule: string;
    };
  };
}
