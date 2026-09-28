import { Injectable, Logger, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import { Between } from 'typeorm';
import {
  ReconciliationReportDto,
  ReconciliationPeriodDto,
  SettlementMismatchDto,
} from './dto/reconciliation-report.dto';

@Injectable()
export class SettlementReconciliationService {
  private readonly logger = new Logger(SettlementReconciliationService.name);

  constructor(
    @Inject('TRADE_REPOSITORY') private readonly tradeRepo: any,
    @Inject('SETTLEMENT_LEDGER_REPOSITORY') private readonly ledgerRepo: any,
  ) {}

  async reconcile(periodStart: Date, periodEnd: Date): Promise<ReconciliationReportDto> {
    const trades: any[] = await this.tradeRepo.find({
      where: { executedAt: Between(periodStart, periodEnd) },
    });

    const ledgerEntries: any[] = await this.ledgerRepo.find({
      where: { createdAt: Between(periodStart, periodEnd) },
    });

    const ledgerByTradeId = new Map<string, any>(
      ledgerEntries.map((e) => [e.tradeId, e]),
    );

    const missingSettlements: string[] = [];
    const mismatchedSettlements: SettlementMismatchDto[] = [];

    for (const trade of trades) {
      const ledgerEntry = ledgerByTradeId.get(trade.id);
      if (!ledgerEntry) {
        missingSettlements.push(trade.id);
        continue;
      }
      if (String(ledgerEntry.amount) !== String(trade.amount)) {
        mismatchedSettlements.push({
          tradeId: trade.id,
          expectedAmount: String(trade.amount),
          actualAmount: String(ledgerEntry.amount),
        });
      }
    }

    const discrepancyCount = missingSettlements.length + mismatchedSettlements.length;

    const report: ReconciliationReportDto = {
      reportId: crypto.randomUUID(),
      periodStart,
      periodEnd,
      totalTrades: trades.length,
      totalSettlements: ledgerEntries.length,
      missingSettlements,
      mismatchedSettlements,
      discrepancyCount,
      status: discrepancyCount === 0 ? 'clean' : 'discrepancies_found',
      generatedAt: new Date(),
    };

    this.logger.log(
      `Reconciliation complete: ${trades.length} trades, ${discrepancyCount} discrepancies`,
    );

    return report;
  }

  async runDailyReconciliation(): Promise<ReconciliationReportDto> {
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const periodStart = new Date(periodEnd.getTime() - 86_400_000);
    return this.reconcile(periodStart, periodEnd);
  }

  async rerunForPeriod(dto: ReconciliationPeriodDto): Promise<ReconciliationReportDto> {
    return this.reconcile(dto.startDate, dto.endDate);
  }
}
