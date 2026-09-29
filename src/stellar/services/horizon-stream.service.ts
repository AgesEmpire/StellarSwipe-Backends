import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Horizon } from '@stellar/stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { IngestionCheckpoint } from '../entities/ingestion-checkpoint.entity';
import { HorizonStreamEvent, StreamCursor } from '../interfaces/horizon-event.interface';

type StreamType = 'transaction' | 'effects';
export type HorizonEventSource = 'live' | 'backfill';

/** Checkpoint-table key prefix for per-stream cursors. */
export const HORIZON_STREAM_CHECKPOINT_PREFIX = 'horizon-stream:';
export const HORIZON_BACKFILL_PAGE_LIMIT = 200;
/** Upper bound on pages replayed per reconnect; the live stream resumes from the cursor after it. */
export const HORIZON_BACKFILL_MAX_PAGES = 500;

/**
 * Orders Horizon paging tokens. Transaction tokens are integers; effect
 * tokens are `<operationId>-<index>`. Both compare numerically part by part.
 */
export function comparePagingTokens(a: string, b: string): number {
  const pa = a.split('-');
  const pb = b.split('-');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = BigInt(pa[i] ?? 0);
    const y = BigInt(pb[i] ?? 0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Streams transactions and effects for watched accounts from Horizon.
 *
 * Gap reconciliation (#1209):
 * - Each stream's last processed paging token is stored durably in the
 *   `ingestion_checkpoints` table (key `horizon-stream:<streamKey>`).
 * - Whenever a stream (re)starts with a known cursor — after a disconnect or a
 *   process restart — the missed events are paged from Horizon in ascending
 *   order and dispatched *before* the live stream is reopened.
 * - If the backfill hits an upstream error, the live stream is not opened;
 *   the reconnect is rescheduled with backoff and resumes from the cursor of
 *   the last event that was dispatched.
 * - Events at or before the current cursor are dropped, so overlap between
 *   backfill pages and the live stream never emits an event twice.
 */
@Injectable()
export class HorizonStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HorizonStreamService.name);
  private server: Horizon.Server;
  private eventEmitter: EventEmitter2;
  private activeStreams = new Map<string, any>();
  private startingStreams = new Set<string>();
  private reconnectTimeouts = new Map<string, NodeJS.Timeout>();
  private watchedAccounts = new Set<string>();
  private streamCursors = new Map<string, StreamCursor>();
  private cursorWrites = new Map<string, Promise<void>>();

  private readonly MAX_RECONNECT_DELAY = 60000; // 1 minute
  private readonly INITIAL_RECONNECT_DELAY = 1000; // 1 second

  constructor(
    private stellarConfig: StellarConfigService,
    @InjectRepository(IngestionCheckpoint)
    private readonly checkpointRepo: Repository<IngestionCheckpoint>,
    eventEmitter: EventEmitter2,
  ) {
    this.server = new Horizon.Server(this.stellarConfig.horizonUrl);
    this.eventEmitter = eventEmitter;
  }

  async onModuleInit() {
    await this.loadStreamCursors();
    this.logger.log('Horizon Stream Service initialized');
  }

  async onModuleDestroy() {
    await this.stopAllStreams();
    this.logger.log('Horizon Stream Service destroyed');
  }

  async addWatchedAccount(publicKey: string): Promise<void> {
    if (this.watchedAccounts.has(publicKey)) {
      this.logger.debug(`Account ${publicKey} already being watched`);
      return;
    }

    this.watchedAccounts.add(publicKey);
    this.logger.log(`Added account to watch list: ${publicKey}`);

    // Start streams for this account if not already running
    await this.startAccountStreams(publicKey);
  }

  async removeWatchedAccount(publicKey: string): Promise<void> {
    this.watchedAccounts.delete(publicKey);
    this.logger.log(`Removed account from watch list: ${publicKey}`);

    // Stop streams for this account if no longer needed
    await this.stopAccountStreams(publicKey);
  }

  private async startAccountStreams(publicKey: string): Promise<void> {
    await this.startStream('transaction', publicKey);
    await this.startStream('effects', publicKey);
  }

  private streamKey(streamType: StreamType, publicKey: string): string {
    return streamType === 'transaction'
      ? `transactions_${publicKey}`
      : `effects_${publicKey}`;
  }

  private callBuilder(streamType: StreamType, publicKey: string) {
    return streamType === 'transaction'
      ? this.server.transactions().forAccount(publicKey)
      : this.server.effects().forAccount(publicKey);
  }

  /** Backfills from the durable cursor, then opens the live stream. */
  private async startStream(streamType: StreamType, publicKey: string): Promise<void> {
    const streamKey = this.streamKey(streamType, publicKey);

    if (this.activeStreams.has(streamKey) || this.startingStreams.has(streamKey)) {
      this.logger.debug(`${streamType} stream already active for ${publicKey}`);
      return;
    }

    this.startingStreams.add(streamKey);
    try {
      const replayed = await this.backfill(streamType, publicKey);
      if (replayed > 0) {
        this.logger.log(`Backfilled ${replayed} missed ${streamType} events for ${publicKey}`);
      }

      // The account may have been unwatched while the backfill was running.
      if (!this.watchedAccounts.has(publicKey)) return;

      this.openLiveStream(streamType, publicKey);
    } catch (error) {
      this.logger.error(`Failed to start ${streamType} stream for ${publicKey}:`, error);
      if (this.watchedAccounts.has(publicKey)) {
        this.scheduleReconnect(streamKey, publicKey, streamType);
      }
    } finally {
      this.startingStreams.delete(streamKey);
    }
  }

  /**
   * Pages every event after the stored cursor in ascending order and
   * dispatches it. Throws on upstream errors so the caller can retry without
   * opening the live stream; the cursor keeps any progress already made.
   */
  private async backfill(streamType: StreamType, publicKey: string): Promise<number> {
    const streamKey = this.streamKey(streamType, publicKey);
    const cursor = this.streamCursors.get(streamKey)?.cursor;
    if (!cursor) return 0;

    let replayed = 0;
    let page = await this.callBuilder(streamType, publicKey)
      .cursor(cursor)
      .order('asc')
      .limit(HORIZON_BACKFILL_PAGE_LIMIT)
      .call();

    for (let pages = 1; ; pages++) {
      const records = (page?.records ?? []) as any[];
      for (const record of records) {
        if (this.dispatchEvent(streamType, publicKey, record, 'backfill')) {
          replayed++;
        }
      }
      await this.persistCursor(streamKey).catch((error) =>
        this.logger.error(`Failed to persist cursor for ${streamKey}:`, error),
      );

      if (records.length < HORIZON_BACKFILL_PAGE_LIMIT) break;
      if (pages >= HORIZON_BACKFILL_MAX_PAGES) {
        this.logger.warn(
          `Backfill for ${streamKey} stopped after ${pages} pages; live stream resumes from cursor`,
        );
        break;
      }
      page = await page.next();
    }

    return replayed;
  }

  private openLiveStream(streamType: StreamType, publicKey: string): void {
    const streamKey = this.streamKey(streamType, publicKey);
    const cursor = this.streamCursors.get(streamKey)?.cursor;
    let builder = this.callBuilder(streamType, publicKey);
    if (cursor) {
      builder = builder.cursor(cursor);
      this.logger.debug(`Resuming ${streamType} stream from cursor: ${cursor}`);
    }

    const stream = builder.stream({
      onmessage: (event: any) =>
        streamType === 'transaction'
          ? this.handleTransactionEvent(publicKey, event)
          : this.handleEffectEvent(publicKey, event),
      onerror: (error: any) => this.handleStreamError(streamKey, publicKey, error),
      reconnectTimeout: this.INITIAL_RECONNECT_DELAY,
    });

    this.activeStreams.set(streamKey, stream);
    this.logger.log(`Started ${streamType} stream for account: ${publicKey}`);
  }

  private handleTransactionEvent(accountId: string, event: any): void {
    if (this.dispatchEvent('transaction', accountId, event, 'live')) {
      this.persistCursor(`transactions_${accountId}`).catch((error) =>
        this.logger.error(`Failed to persist cursor for ${accountId}:`, error),
      );
    }
  }

  private handleEffectEvent(accountId: string, event: any): void {
    if (this.dispatchEvent('effects', accountId, event, 'live')) {
      this.persistCursor(`effects_${accountId}`).catch((error) =>
        this.logger.error(`Failed to persist cursor for ${accountId}:`, error),
      );
    }
  }

  /**
   * Emits one Horizon record and advances the in-memory cursor.
   * Returns false when the record was a duplicate or could not be processed.
   */
  private dispatchEvent(
    streamType: StreamType,
    accountId: string,
    event: any,
    source: HorizonEventSource,
  ): boolean {
    const streamKey = this.streamKey(streamType, accountId);
    try {
      if (this.isDuplicate(streamKey, event?.paging_token)) {
        this.logger.debug(`Ignoring duplicate ${streamType} event ${event.paging_token} for ${accountId}`);
        return false;
      }

      if (streamType === 'transaction') {
        const streamEvent: HorizonStreamEvent = {
          id: event.id,
          paging_token: event.paging_token,
          successful: event.successful,
          hash: event.hash,
          ledger: event.ledger,
          created_at: event.created_at,
          source_account: event.source_account,
          type: 'transaction',
          data: event,
        };
        this.eventEmitter.emit('horizon.transaction', { accountId, event: streamEvent, source });
        this.logger.debug(`Transaction event processed for ${accountId}: ${event.hash}`);
      } else {
        const streamEvent: HorizonStreamEvent = {
          id: event.id,
          paging_token: event.paging_token,
          successful: true,
          hash: event.transaction_hash || '',
          ledger: 0, // Effects don't have ledger directly
          created_at: event.created_at,
          source_account: event.account,
          type: 'effect',
          data: event,
        };
        this.eventEmitter.emit('horizon.effect', { accountId, event: streamEvent, source });
        this.logger.debug(`Effect event processed for ${accountId}: ${event.type}`);
      }

      this.updateStreamCursor(streamKey, event.paging_token);
      return true;
    } catch (error) {
      this.logger.error(`Error processing ${streamType} event for ${accountId}:`, error);
      return false;
    }
  }

  private isDuplicate(streamKey: string, pagingToken: string | undefined): boolean {
    const cursor = this.streamCursors.get(streamKey)?.cursor;
    if (!pagingToken || !cursor) return false;
    try {
      return comparePagingTokens(pagingToken, cursor) <= 0;
    } catch {
      return pagingToken === cursor;
    }
  }

  private handleStreamError(streamKey: string, accountId: string, error: any): void {
    this.logger.error(`Stream error for ${streamKey}:`, error);

    // Close the current stream
    const stream = this.activeStreams.get(streamKey);
    if (stream && typeof stream.close === 'function') {
      stream.close();
    }
    this.activeStreams.delete(streamKey);

    // Schedule reconnection (which backfills the gap before going live)
    const streamType: StreamType = streamKey.startsWith('transactions_') ? 'transaction' : 'effects';
    this.scheduleReconnect(streamKey, accountId, streamType);
  }

  private scheduleReconnect(streamKey: string, accountId: string, streamType: StreamType): void {
    // Clear existing timeout
    const existingTimeout = this.reconnectTimeouts.get(streamKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Calculate reconnect delay with exponential backoff
    const cursor = this.streamCursors.get(streamKey);
    const reconnectCount = cursor?.reconnectCount || 0;
    const delay = Math.min(
      this.INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectCount),
      this.MAX_RECONNECT_DELAY
    );

    this.logger.log(`Scheduling reconnect for ${streamKey} in ${delay}ms (attempt ${reconnectCount + 1})`);

    const timeout = setTimeout(async () => {
      this.reconnectTimeouts.delete(streamKey);

      // Update reconnect count
      this.updateReconnectCount(streamKey);

      await this.startStream(streamType, accountId);
    }, delay);

    this.reconnectTimeouts.set(streamKey, timeout);
  }

  private updateStreamCursor(streamKey: string, pagingToken: string): void {
    const existing = this.streamCursors.get(streamKey) || {
      cursor: '',
      lastEventTime: new Date(),
      reconnectCount: 0,
    };

    this.streamCursors.set(streamKey, {
      ...existing,
      cursor: pagingToken,
      lastEventTime: new Date(),
      reconnectCount: 0, // Reset on successful event
    });
  }

  private updateReconnectCount(streamKey: string): void {
    const existing = this.streamCursors.get(streamKey) || {
      cursor: '',
      lastEventTime: new Date(),
      reconnectCount: 0,
    };

    this.streamCursors.set(streamKey, {
      ...existing,
      reconnectCount: existing.reconnectCount + 1,
    });
  }

  /**
   * Writes the stream's latest cursor to the checkpoint table. Writes are
   * serialised per stream and each reads the newest in-memory cursor, so a
   * slow earlier write can never overwrite a newer cursor.
   */
  private persistCursor(streamKey: string): Promise<void> {
    const previous = this.cursorWrites.get(streamKey) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const cursor = this.streamCursors.get(streamKey)?.cursor;
        if (!cursor) return;
        await this.checkpointRepo.upsert(
          { key: `${HORIZON_STREAM_CHECKPOINT_PREFIX}${streamKey}`, cursor },
          ['key'],
        );
      });
    this.cursorWrites.set(streamKey, next);
    return next;
  }

  private async loadStreamCursors(): Promise<void> {
    try {
      const rows = await this.checkpointRepo.find({
        where: { key: Like(`${HORIZON_STREAM_CHECKPOINT_PREFIX}%`) },
      });
      for (const row of rows) {
        if (!row.cursor) continue;
        this.streamCursors.set(row.key.slice(HORIZON_STREAM_CHECKPOINT_PREFIX.length), {
          cursor: row.cursor,
          lastEventTime: row.updatedAt ?? new Date(),
          reconnectCount: 0,
        });
      }
      this.logger.log(`Loaded ${rows.length} durable stream cursors`);
    } catch (error) {
      this.logger.error('Failed to load stream cursors:', error);
    }
  }

  private async stopAccountStreams(publicKey: string): Promise<void> {
    const transactionStreamKey = `transactions_${publicKey}`;
    const effectsStreamKey = `effects_${publicKey}`;

    // Stop transaction stream
    const transactionStream = this.activeStreams.get(transactionStreamKey);
    if (transactionStream && typeof transactionStream.close === 'function') {
      transactionStream.close();
      this.activeStreams.delete(transactionStreamKey);
    }

    // Stop effects stream
    const effectsStream = this.activeStreams.get(effectsStreamKey);
    if (effectsStream && typeof effectsStream.close === 'function') {
      effectsStream.close();
      this.activeStreams.delete(effectsStreamKey);
    }

    // Clear reconnect timeouts
    [transactionStreamKey, effectsStreamKey].forEach(key => {
      const timeout = this.reconnectTimeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.reconnectTimeouts.delete(key);
      }
    });

    this.logger.log(`Stopped streams for account: ${publicKey}`);
  }

  private async stopAllStreams(): Promise<void> {
    // Close all active streams
    for (const stream of this.activeStreams.values()) {
      if (stream && typeof stream.close === 'function') {
        stream.close();
      }
    }
    this.activeStreams.clear();

    // Clear all timeouts
    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();

    // Let in-flight cursor writes land so the next start resumes precisely
    await Promise.allSettled(this.cursorWrites.values());

    this.logger.log('All streams stopped');
  }

  getStreamStatus(): {
    activeStreams: string[];
    backfillingStreams: string[];
    watchedAccounts: string[];
    cursors: Record<string, StreamCursor>;
  } {
    return {
      activeStreams: Array.from(this.activeStreams.keys()),
      backfillingStreams: Array.from(this.startingStreams),
      watchedAccounts: Array.from(this.watchedAccounts),
      cursors: Object.fromEntries(this.streamCursors.entries()),
    };
  }
}
