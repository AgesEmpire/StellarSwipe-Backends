/**
 * HorizonStreamService gap reconciliation (#1209).
 *
 * A scripted in-memory Horizon replaces the SDK server: it serves ordered,
 * paginated history for `.call()` and hands out controllable live streams for
 * `.stream()`, so tests can simulate disconnects, missed events, duplicate
 * deliveries and upstream failures deterministically.
 */
type StreamKind = 'transactions' | 'effects';

interface LiveStream {
  kind: StreamKind;
  account: string;
  cursor?: string;
  closed: boolean;
  onmessage: (event: any) => void;
  onerror: (error: any) => void;
  close: () => void;
}

class ScriptedHorizon {
  ledger: Record<StreamKind, any[]> = { transactions: [], effects: [] };
  streams: LiveStream[] = [];
  calls: Array<{ kind: StreamKind; cursor?: string; limit?: number }> = [];
  /** Queue of errors thrown by the next `.call()` / `page.next()` requests. */
  failures: Error[] = [];
  timeline: string[] = [];

  add(kind: StreamKind, token: string, extra: object = {}) {
    const record =
      kind === 'transactions'
        ? { id: `tx-${token}`, paging_token: token, hash: `hash-${token}`, successful: true, ledger: 1, ...extra }
        : { id: `ef-${token}`, paging_token: token, type: 'account_credited', transaction_hash: `hash-${token}`, ...extra };
    this.ledger[kind].push(record);
    return record;
  }

  page(kind: StreamKind, cursor: string | undefined, limit: number): any {
    this.calls.push({ kind, cursor, limit });
    const failure = this.failures.shift();
    if (failure) throw failure;
    const after = this.ledger[kind].filter(
      (r) => !cursor || comparePagingTokens(r.paging_token, cursor) > 0,
    );
    const records = after.slice(0, limit);
    const last = records[records.length - 1]?.paging_token ?? cursor;
    return {
      records,
      next: async () => this.page(kind, last, limit),
    };
  }

  builder(kind: StreamKind, account: string) {
    const state: { cursor?: string; limit: number } = { limit: 10 };
    const b: any = {
      cursor: (c: string) => ((state.cursor = c), b),
      order: () => b,
      limit: (n: number) => ((state.limit = n), b),
      call: async () => this.page(kind, state.cursor, state.limit),
      stream: (handlers: any) => {
        const stream: LiveStream = {
          kind,
          account,
          cursor: state.cursor,
          closed: false,
          onmessage: handlers.onmessage,
          onerror: handlers.onerror,
          close: () => {
            stream.closed = true;
          },
        };
        this.streams.push(stream);
        this.timeline.push(`open:${kind}:${state.cursor ?? 'now'}`);
        return stream;
      },
    };
    return b;
  }

  openStream(kind: StreamKind): LiveStream | undefined {
    return this.streams.filter((s) => s.kind === kind && !s.closed).pop();
  }
}

const mockHorizon: { current: ScriptedHorizon } = { current: undefined as any };

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      transactions: () => ({
        forAccount: (a: string) => mockHorizon.current.builder('transactions', a),
      }),
      effects: () => ({
        forAccount: (a: string) => mockHorizon.current.builder('effects', a),
      }),
    })),
  },
}));

import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  HORIZON_BACKFILL_PAGE_LIMIT,
  HORIZON_STREAM_CHECKPOINT_PREFIX,
  HorizonStreamService,
  comparePagingTokens,
} from '../services/horizon-stream.service';

const ACCOUNT = 'GACCOUNTWATCHED';
const TX_KEY = `transactions_${ACCOUNT}`;
const EF_KEY = `effects_${ACCOUNT}`;

describe('comparePagingTokens', () => {
  it('orders numeric transaction tokens beyond Number precision', () => {
    expect(comparePagingTokens('9007199254740993', '9007199254740992')).toBe(1);
    expect(comparePagingTokens('100', '100')).toBe(0);
    expect(comparePagingTokens('99', '100')).toBe(-1);
  });

  it('orders effect tokens by operation id, then index', () => {
    expect(comparePagingTokens('100-2', '100-10')).toBe(-1);
    expect(comparePagingTokens('101-1', '100-10')).toBe(1);
    expect(comparePagingTokens('100-1', '100')).toBe(1);
  });
});

describe('HorizonStreamService gap reconciliation', () => {
  let horizon: ScriptedHorizon;
  let service: HorizonStreamService;
  let checkpoints: Map<string, string>;
  let checkpointRepo: { find: jest.Mock; upsert: jest.Mock };
  let emitted: Array<{ name: string; token: string; source: string }>;

  const tokens = (source?: string) =>
    emitted.filter((e) => !source || e.source === source).map((e) => e.token);

  async function createService(initial: Record<string, string> = {}) {
    checkpoints = new Map(
      Object.entries(initial).map(([k, v]) => [`${HORIZON_STREAM_CHECKPOINT_PREFIX}${k}`, v]),
    );
    checkpointRepo = {
      find: jest.fn(async () =>
        [...checkpoints].map(([key, cursor]) => ({ key, cursor, updatedAt: new Date() })),
      ),
      upsert: jest.fn(async (row: { key: string; cursor: string }) => {
        checkpoints.set(row.key, row.cursor);
      }),
    };
    const emitter = {
      emit: jest.fn((name: string, payload: any) => {
        emitted.push({ name, token: payload.event.paging_token, source: payload.source });
        horizon.timeline.push(`emit:${payload.source}:${payload.event.paging_token}`);
        return true;
      }),
    };
    service = new HorizonStreamService(
      { horizonUrl: 'https://horizon.example' } as any,
      checkpointRepo as any,
      emitter as unknown as EventEmitter2,
    );
    for (const level of ['log', 'debug', 'warn', 'error'] as const) {
      jest.spyOn((service as any).logger, level).mockImplementation(() => undefined);
    }
    await service.onModuleInit();
  }

  const durableCursor = (key: string) =>
    checkpoints.get(`${HORIZON_STREAM_CHECKPOINT_PREFIX}${key}`);

  beforeEach(() => {
    horizon = new ScriptedHorizon();
    mockHorizon.current = horizon;
    emitted = [];
  });

  afterEach(async () => {
    await service?.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('opens a live stream from "now" when no durable cursor exists', async () => {
    horizon.add('transactions', '100');
    await createService();

    await service.addWatchedAccount(ACCOUNT);

    expect(horizon.calls).toHaveLength(0);
    expect(horizon.openStream('transactions')?.cursor).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });

  it('backfills from the durable cursor before live processing resumes', async () => {
    for (const t of ['90', '100', '101', '102', '103']) horizon.add('transactions', t);
    await createService({ [TX_KEY]: '100' });

    await service.addWatchedAccount(ACCOUNT);

    expect(tokens('backfill')).toEqual(['101', '102', '103']);
    const txTimeline = horizon.timeline.filter((e) => !e.includes('effects'));
    expect(txTimeline).toEqual([
      'emit:backfill:101',
      'emit:backfill:102',
      'emit:backfill:103',
      'open:transactions:103',
    ]);
    expect(durableCursor(TX_KEY)).toBe('103');
  });

  it('pages through large gaps in order without duplicates', async () => {
    const total = HORIZON_BACKFILL_PAGE_LIMIT * 2 + 17;
    for (let i = 1; i <= total; i++) horizon.add('transactions', String(1000 + i));
    await createService({ [TX_KEY]: '1000' });

    await service.addWatchedAccount(ACCOUNT);

    const replayed = tokens('backfill');
    expect(replayed).toHaveLength(total);
    expect(new Set(replayed).size).toBe(total);
    expect(replayed[replayed.length - 1]).toBe(String(1000 + total));
    expect(horizon.calls.filter((c) => c.kind === 'transactions')).toHaveLength(3);
    expect(horizon.openStream('transactions')?.cursor).toBe(String(1000 + total));
  });

  it('backfills effect streams using composite paging tokens', async () => {
    for (const t of ['500-1', '500-2', '501-1']) horizon.add('effects', t);
    await createService({ [EF_KEY]: '500-1' });

    await service.addWatchedAccount(ACCOUNT);

    expect(emitted.filter((e) => e.name === 'horizon.effect').map((e) => e.token)).toEqual([
      '500-2',
      '501-1',
    ]);
    expect(horizon.openStream('effects')?.cursor).toBe('501-1');
  });

  it('ignores duplicate events that overlap the cursor', async () => {
    for (const t of ['101', '102']) horizon.add('transactions', t);
    await createService({ [TX_KEY]: '100' });
    await service.addWatchedAccount(ACCOUNT);

    const live = horizon.openStream('transactions')!;
    live.onmessage(horizon.ledger.transactions[0]); // 101 again
    live.onmessage(horizon.ledger.transactions[1]); // 102 again
    live.onmessage(horizon.add('transactions', '103'));
    live.onmessage(horizon.ledger.transactions[2]); // 103 redelivered

    expect(tokens()).toEqual(['101', '102', '103']);
    expect(tokens('live')).toEqual(['103']);
    await new Promise((resolve) => setImmediate(resolve)); // let the cursor write land
    expect(durableCursor(TX_KEY)).toBe('103');
  });

  it('reconciles events missed while disconnected before reopening the stream', async () => {
    jest.useFakeTimers();
    horizon.add('transactions', '101');
    await createService({ [TX_KEY]: '100' });
    await service.addWatchedAccount(ACCOUNT);

    const first = horizon.openStream('transactions')!;
    first.onmessage(horizon.add('transactions', '102'));
    first.onerror(new Error('socket hang up'));
    expect(first.closed).toBe(true);

    // Events produced while the stream was down.
    horizon.add('transactions', '103');
    horizon.add('transactions', '104');
    horizon.timeline = [];

    await jest.advanceTimersByTimeAsync(1000);

    expect(tokens()).toEqual(['101', '102', '103', '104']);
    expect(horizon.timeline.filter((e) => !e.includes('effects'))).toEqual([
      'emit:backfill:103',
      'emit:backfill:104',
      'open:transactions:104',
    ]);
    expect(durableCursor(TX_KEY)).toBe('104');
  });

  it('does not go live after an upstream error and retries from the cursor', async () => {
    jest.useFakeTimers();
    for (const t of ['101', '102']) horizon.add('transactions', t);
    await createService({ [TX_KEY]: '100' });
    horizon.failures.push(Object.assign(new Error('Horizon 503'), { response: { status: 503 } }));

    await service.addWatchedAccount(ACCOUNT);

    expect(horizon.openStream('transactions')).toBeUndefined();
    expect(emitted.filter((e) => e.name === 'horizon.transaction')).toHaveLength(0);
    expect(service.getStreamStatus().activeStreams).not.toContain(TX_KEY);

    await jest.advanceTimersByTimeAsync(1000);

    expect(tokens()).toEqual(['101', '102']);
    expect(horizon.openStream('transactions')?.cursor).toBe('102');
  });

  it('keeps progress from pages already replayed when a later page fails', async () => {
    jest.useFakeTimers();
    const total = HORIZON_BACKFILL_PAGE_LIMIT + 5;
    for (let i = 1; i <= total; i++) horizon.add('transactions', String(i + 1));
    await createService({ [TX_KEY]: '1' });

    // First page succeeds, the follow-up page request fails.
    const realPage = horizon.page.bind(horizon);
    let requests = 0;
    jest.spyOn(horizon, 'page').mockImplementation((kind, cursor, limit) => {
      if (kind === 'transactions' && ++requests === 2) throw new Error('ECONNRESET');
      return realPage(kind, cursor, limit);
    });

    await service.addWatchedAccount(ACCOUNT);
    expect(tokens()).toHaveLength(HORIZON_BACKFILL_PAGE_LIMIT);
    expect(horizon.openStream('transactions')).toBeUndefined();
    const checkpointAfterFailure = durableCursor(TX_KEY);
    expect(checkpointAfterFailure).toBe(String(HORIZON_BACKFILL_PAGE_LIMIT + 1));

    await jest.advanceTimersByTimeAsync(1000);

    const all = tokens();
    expect(all).toHaveLength(total);
    expect(new Set(all).size).toBe(total);
    expect(horizon.openStream('transactions')?.cursor).toBe(String(total + 1));
  });

  it('still goes live when persisting the cursor fails', async () => {
    horizon.add('transactions', '101');
    await createService({ [TX_KEY]: '100' });
    checkpointRepo.upsert.mockRejectedValue(new Error('db down'));

    await service.addWatchedAccount(ACCOUNT);

    expect(tokens()).toEqual(['101']);
    expect(horizon.openStream('transactions')?.cursor).toBe('101');
  });

  it('does not open a live stream for an account unwatched during backfill', async () => {
    horizon.add('transactions', '101');
    await createService({ [TX_KEY]: '100' });
    const realPage = horizon.page.bind(horizon);
    jest.spyOn(horizon, 'page').mockImplementation((kind, cursor, limit) => {
      void service.removeWatchedAccount(ACCOUNT);
      return realPage(kind, cursor, limit);
    });

    await service.addWatchedAccount(ACCOUNT);

    expect(horizon.openStream('transactions')).toBeUndefined();
  });
});
