import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { OnChainEvent, OnChainEventType } from './entities/on-chain-event.entity';
import { StellarConfigService } from '../config/stellar.service';

interface RawTx {
  hash: string;
  ledger: number;
  created_at: string;
  successful: boolean;
  operations?: () => Promise<{ records: StellarSdk.Horizon.ServerApi.OperationRecord[] }>;
}

@Injectable()
export class OnChainSyncService {
  private readonly logger = new Logger(OnChainSyncService.name);
  private readonly server: StellarSdk.Horizon.Server;
  /** Last synced ledger sequence — persisted in-memory; survives restarts via DB watermark */
  private lastSyncedLedger = 0;

  constructor(
    @InjectRepository(OnChainEvent)
    private readonly eventRepo: Repository<OnChainEvent>,
    private readonly stellarConfig: StellarConfigService,
  ) {
    this.server = new StellarSdk.Horizon.Server(this.stellarConfig.horizonUrl);
  }

  /** Called by the scheduler job. Polls the next batch of ledgers. */
  async syncLatestEvents(): Promise<number> {
    await this.initWatermark();

    let synced = 0;
    try {
      const txPage = await this.server
        .transactions()
        .cursor(this.lastSyncedLedger > 0 ? String(this.lastSyncedLedger) : 'now')
        .limit(50)
        .order('asc')
        .call();

      for (const tx of txPage.records as unknown as RawTx[]) {
        if (!tx.successful) continue;
        const events = await this.extractEvents(tx);
        for (const event of events) {
          await this.persistIdempotent(event);
          synced++;
        }
        this.lastSyncedLedger = tx.ledger;
      }
    } catch (err) {
      this.logger.error('On-chain sync failed', (err as Error).message);
    }

    return synced;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async initWatermark(): Promise<void> {
    if (this.lastSyncedLedger > 0) return;
    const latest = await this.eventRepo
      .createQueryBuilder('e')
      .select('MAX(e.ledger)', 'max')
      .getRawOne<{ max: number | null }>();
    this.lastSyncedLedger = latest?.max ?? 0;
  }

  private async extractEvents(tx: RawTx): Promise<Omit<OnChainEvent, 'id' | 'createdAt'>[]> {
    const events: Omit<OnChainEvent, 'id' | 'createdAt'>[] = [];
    let ops: StellarSdk.Horizon.ServerApi.OperationRecord[] = [];

    try {
      if (typeof tx.operations === 'function') {
        const page = await tx.operations();
        ops = page.records;
      }
    } catch {
      // operations fetch is best-effort
    }

    ops.forEach((op, idx) => {
      const eventType = this.classifyOperation(op);
      if (!eventType) return;

      events.push({
        txHash: tx.hash,
        eventIndex: idx,
        ledger: tx.ledger,
        eventType,
        contractId: (op as any).contract_id ?? undefined,
        payload: op as unknown as Record<string, unknown>,
        ledgerCloseTime: tx.created_at ? new Date(tx.created_at) : undefined,
      });
    });

    return events;
  }

  private classifyOperation(
    op: StellarSdk.Horizon.ServerApi.OperationRecord,
  ): OnChainEventType | null {
    const t = op.type as string;
    if (
      t === 'manage_sell_offer' ||
      t === 'manage_buy_offer' ||
      t === 'path_payment_strict_send' ||
      t === 'path_payment_strict_receive'
    ) return OnChainEventType.TRADE_EXECUTED;
    if (t === 'invoke_host_function') return OnChainEventType.CONTRACT_RESULT;
    if (t === 'change_trust') return OnChainEventType.STAKE_CHANGED;
    return null;
  }

  /**
   * INSERT … ON CONFLICT DO NOTHING — fully idempotent.
   * Duplicate (txHash, eventIndex) pairs are silently skipped.
   */
  private async persistIdempotent(
    data: Omit<OnChainEvent, 'id' | 'createdAt'>,
  ): Promise<void> {
    try {
      await this.eventRepo
        .createQueryBuilder()
        .insert()
        .into(OnChainEvent)
        .values(data)
        .orIgnore()
        .execute();
    } catch (err) {
      // Unique-violation from a race condition — safe to ignore
      this.logger.debug(`Skipping duplicate event ${data.txHash}[${data.eventIndex}]`);
    }
  }
}
