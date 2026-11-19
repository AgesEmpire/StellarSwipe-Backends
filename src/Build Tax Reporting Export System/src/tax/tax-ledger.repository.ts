import { BadRequestException, Injectable } from '@nestjs/common';
import { TaxLedgerEntry } from './tax-report.types';

@Injectable()
export class TaxLedgerRepository {
  private readonly entries = new Map<string, TaxLedgerEntry>();

  save(entry: TaxLedgerEntry): void {
    if (
      !(entry.dateSold instanceof Date) ||
      Number.isNaN(entry.dateSold.getTime()) ||
      !(entry.dateAcquired instanceof Date) ||
      Number.isNaN(entry.dateAcquired.getTime())
    ) {
      throw new BadRequestException('Ledger entry dates must be valid dates');
    }

    this.entries.set(entry.id, {
      ...entry,
      dateAcquired: new Date(entry.dateAcquired),
      dateSold: new Date(entry.dateSold),
    });
  }

  findBySaleYear(taxYear: number): TaxLedgerEntry[] {
    return Array.from(this.entries.values())
      .filter(entry => entry.dateSold.getUTCFullYear() === taxYear)
      .map(entry => ({
        ...entry,
        dateAcquired: new Date(entry.dateAcquired),
        dateSold: new Date(entry.dateSold),
      }));
  }
}
