import { BadRequestException } from '@nestjs/common';
import { TaxReportQueryDto } from '../dto/tax-report-query.dto';
import { TaxReportResultDto } from '../dto/tax-report-result.dto';
import { TaxLedgerEntry } from '../tax-report.types';

export class CapitalGainsCalculator {
  calculate(
    query: TaxReportQueryDto,
    entries: TaxLedgerEntry[],
    classifications: Record<string, string>,
    metadata: TaxReportResultDto['metadata'],
  ): TaxReportResultDto {
    const transactions = entries
      .filter(
        entry =>
          entry.status === 'finalized' &&
          entry.dateSold.getUTCFullYear() === query.taxYear,
      )
      .sort(
        (first, second) =>
          first.dateSold.getTime() - second.dateSold.getTime() ||
          first.id.localeCompare(second.id),
      )
      .map(entry => {
        const classification = classifications[entry.asset];
        if (!classification) {
          throw new BadRequestException(
            `No tax classification is configured for asset ${entry.asset}`,
          );
        }
        return {
          ledgerEntryId: entry.id,
          dateAcquired: entry.dateAcquired,
          dateSold: entry.dateSold,
          asset: entry.asset,
          quantity: entry.quantity,
          costBasis: entry.costBasis,
          proceeds: entry.proceeds,
          gainLoss: entry.proceeds - entry.costBasis,
          term: entry.term,
          classification,
        };
      });
    const gains = transactions.filter(transaction => transaction.gainLoss > 0);
    const losses = transactions.filter(transaction => transaction.gainLoss < 0);
    const netPnL = transactions.reduce(
      (total, transaction) => total + transaction.gainLoss,
      0,
    );

    return {
      taxYear: query.taxYear,
      method: query.method,
      transactions,
      summary: {
        totalGains: gains.reduce(
          (total, transaction) => total + transaction.gainLoss,
          0,
        ),
        totalLosses: Math.abs(
          losses.reduce((total, transaction) => total + transaction.gainLoss, 0),
        ),
        netPnL,
        shortTermGains: gains
          .filter(transaction => transaction.term === 'short')
          .reduce((total, transaction) => total + transaction.gainLoss, 0),
        longTermGains: gains
          .filter(transaction => transaction.term === 'long')
          .reduce((total, transaction) => total + transaction.gainLoss, 0),
      },
      metadata,
    };
  }
}
