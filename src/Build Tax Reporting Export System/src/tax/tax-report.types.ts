export type TaxJurisdiction = 'US' | 'EU' | 'NG';

export type LedgerEntryStatus =
  | 'finalized'
  | 'pending'
  | 'reversed'
  | 'corrected';

export interface TaxLedgerEntry {
  id: string;
  status: LedgerEntryStatus;
  dateAcquired: Date;
  dateSold: Date;
  asset: string;
  quantity: number;
  costBasis: number;
  proceeds: number;
  term: 'short' | 'long';
}

export interface TaxJurisdictionConfiguration {
  jurisdiction: TaxJurisdiction;
  version: string;
  effectiveFrom: string;
  effectiveTo: string;
}

export interface TaxMappingSet {
  version: string;
  effectiveFrom: string;
  effectiveTo: string;
  classifications: Record<string, string>;
}
