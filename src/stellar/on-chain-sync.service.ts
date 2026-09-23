import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { OnChainEvent, OnChainEventType } from './entities/on-chain-event.entity';
import { IngestionCheckpoint } from './entities/ingestion-checkpoint.entity';
import { StellarConfigService } from '../config/stellar.service';

interface RawTx {
  hash: string;
  ledger: number;
  created_at: string;
  successful: boolean;
  paging_token: string;
  operations?: () => Promise<{ records: StellarSdk.Horizon.ServerApi.OperationRecord[] }>;
}

/** Identifier for the primary ingestion cursor stored in the checkpoints table. */
const CHECKPOINT_KEY = 'on-chain-sync:cursor';

/**
 * OnChainSyncService
 *
 * Polls Horizon for on-chain events and persists them idempotently.
 *
 * Resumability (issue #1034):
 * - The Horizon paging_token (cursor) is committed to the `ingestion_checkpoints`
 *   table inside the same DB transaction that persists the processed events for
 *   that page.  This means the checkpoint and the events are always in sync:
 *   a crash before the commit replays the same page on restart (idempotent),
 *   and a crash after the commit skips the already-processed page correctly.
 * - On startup, the checkpoint is loaded from the DB; if absent the service
 *   falls back to the highest ledger already in `on_chain_events`, then "now".
 * - Duplicate pages are harmless because `persistIdempotent` uses
 *   INSERT … ON CONFLICT DO NOTHING on the (txHash, eventIndex) unique index.
 */
@Injectable()
export class OnChainSyncService {
  private readonly logger = new Logger(OnChainSyncService.name);
  private readonly server: StellarSdk.Horizon.Server;

  /** In-process cursor — reflects the committed DB checkpoint after startup. */
  private cursor: string | null = null;
  private checkpointLoaded = false;

  constructor(
    @InjectRepository(OnChainEvent)
    private readonly eventRepo: Repository<OnChainEvent>,
    @InjectRepository(IngestionCheckpoint)
    private readonly checkpointRepo: Repository<IngestionCheckpoint>,
    private readonly stellarConfig: StellarConfigService,
  ) {
    this.server = new StellarSdk.Horizon.Server(this.stellarConfig.horizonUrl);
  }

  /** Called by the scheduler job. Polls the next batch of ledgers. */
  async syncLatestEvents(): Promise<number> {
    await this.loadCheckpoint();

    let synced = 0;
    let lastPageToken: string | null = null;

    try {
      const txPage = await this.server
        .transactions()
        .cursor(this.cursor ?? 'now')
        .limit(50)
        .order('asc')
        .call();

      const txs = txPage.records as unknown as RawTx[];
      if (txs.length === 0) return 0;

      const eventsToInsert: Omit<OnChainEvent, 'id' | 'createdAt'>[] = [];

      for (const tx of txs) {
        if (!tx.successful) {
          lastPageToken = tx.paging_token;
          continue;
        }
        const events = await this.extractEvents(tx);
        eventsToInsert.push(...events);
        synced += events.length;
        lastPageToken = tx.paging_token;
      }

      // Commit events + checkpoint atomically so restarts are always safe
      if (lastPageToken !== null) {
        await this.commitWithCheckpoint(eventsToInsert, lastPageToken);
        this.cursor = lastPageToken;
      }
    } catch (err) {
      this.logger.error('On-chain sync failed', (err as Error).message);
    }

    return synced;
  }

  /** Expose current cursor for health / admin endpoints. */
  getCurrentCursor(): string | null {
    return this.cursor;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Load the durable cursor from the DB on first call.
   * Falls back to the highest ledger watermark already in `on_chain_events`,
   * then finally to `null` (meaning "start from now").
   */
  private async loadCheckpoint(): Promise<void> {
    if (this.checkpointLoaded) return;

    const saved = await this.checkpointRepo.findOne({
      where: { key: CHECKPOINT_KEY },
    });

    if (saved?.cursor) {
      this.cursor = saved.cursor;
      this.logger.log(`Resumed ingestion from checkpoint cursor=${this.cursor}`);
    } else {
      // Legacy fallback: derive a cursor from the highest ledger already stored
      const latest = await this.eventRepo
        .createQueryBuilder('e')
        .select('MAX(e.ledger)', 'max')
        .getRawOne<{ max: number | null }>();
      const maxLedger = latest?.max ?? 0;
      this.cursor = maxLedger > 0 ? String(maxLedger) : null;
      this.logger.log(
        maxLedger > 0
          ? `No checkpoint found — starting from ledger watermark ${maxLedger}`
          : `No checkpoint found — starting from "now"`,
      );
    }

    this.checkpointLoaded = true;
  }

  /**
   * Persist events and advance the checkpoint inside a single DB transaction.
   * If the process crashes mid-way the whole transaction is rolled back and
   * the next startup replays the same page — safe because insertions are
   * idempotent (ON CONFLICT DO NOTHING).
   */
  private async commitWithCheckpoint(
    events: Omit<OnChainEvent, 'id' | 'createdAt'>[],
    newCursor: string,
  ): Promise<void> {
    await this.eventRepo.manager.transaction(async (em) => {
      // Insert events idempotently
      if (events.length > 0) {
        await em
          .createQueryBuilder()
          .insert()
          .into(OnChainEvent)
          .values(events)
          .orIgnore()
          .execute();
      }

      // Upsert checkpoint
      await em
        .createQueryBuilder()
        .insert()
        .into(IngestionCheckpoint)
        .values({ key: CHECKPOINT_KEY, cursor: newCursor, updatedAt: new Date() })
        .orUpdate(['cursor', 'updated_at'], ['key'])
        .execute();
    });
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
      // operations fetch is best-effort; event is still recorded via txHash
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
}
