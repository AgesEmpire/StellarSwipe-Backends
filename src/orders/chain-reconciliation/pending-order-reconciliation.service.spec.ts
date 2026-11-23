import { ConflictException } from '@nestjs/common';
import { Trade, TradeStatus } from '../../trades/entities/trade.entity';
import { TradeFailureCode } from '../../trades/errors/trade-failure-codes';
import { ChainObservation } from './chain-confirmation.source';
import { OrderReconciliationEvidence, OrderReconciliationReview } from './order-reconciliation.entity';
import { PendingOrderReconciliationService, RECONCILABLE_STATUSES } from './pending-order-reconciliation.service';
import { ReviewReason, decideReconciliation } from './reconciliation-policy';

const HASH = 'a'.repeat(64);
const NOW = new Date('2026-11-23T12:00:00.000Z');
const GRACE_MS = 30 * 60 * 1000;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const obs = (source: string, outcome: ChainObservation['outcome'], extra: Partial<ChainObservation> = {}): ChainObservation => ({
  source,
  outcome,
  observedAt: NOW.toISOString(),
  ...(outcome === 'success' || outcome === 'failed' ? { hash: HASH, ledger: 500 } : {}),
  ...extra,
});

describe('decideReconciliation policy (#1531)', () => {
  const base = { txHash: HASH, submittedAt: new Date(NOW.getTime() - 10 * 60 * 1000), now: NOW };
  const late = { ...base, submittedAt: new Date(NOW.getTime() - GRACE_MS - 1) };
  const cfg = { missingGraceMs: GRACE_MS };

  it.each([
    ['all success → confirm', base, [obs('h1', 'success'), obs('h2', 'success')], 'confirm'],
    ['all failed → fail', base, [obs('h1', 'failed'), obs('h2', 'failed')], 'fail'],
    ['success + transient error → confirm', base, [obs('h1', 'success'), obs('h2', 'error')], 'confirm'],
    ['only errors → defer', base, [obs('h1', 'error')], 'defer'],
    ['no sources → defer', base, [], 'defer'],
    ['missing within grace → defer', base, [obs('h1', 'not_found')], 'defer'],
    ['missing past grace → review', late, [obs('h1', 'not_found'), obs('h2', 'not_found')], 'review'],
    ['success vs failed → review', base, [obs('h1', 'success'), obs('h2', 'failed')], 'review'],
    ['different ledgers → review', base, [obs('h1', 'success'), obs('h2', 'success', { ledger: 501 })], 'review'],
    ['hash mismatch → review', base, [obs('h1', 'success', { hash: 'b'.repeat(64) })], 'review'],
    ['partial visibility within grace → defer', base, [obs('h1', 'success'), obs('h2', 'not_found')], 'defer'],
    ['partial visibility past grace → review', late, [obs('h1', 'success'), obs('h2', 'not_found')], 'review'],
  ] as const)('%s', (_l, input, observations, action) => {
    expect(decideReconciliation({ ...input, observations: [...observations] }, cfg).action).toBe(action);
  });

  it('flags a chain ledger that contradicts the locally recorded one', () => {
    const d = decideReconciliation({ ...base, localLedger: 499, observations: [obs('h1', 'success')] }, cfg);
    expect(d).toMatchObject({ action: 'review', reason: ReviewReason.LEDGER_MISMATCH_LOCAL });
  });
});

function createHarness(trades: Partial<Trade>[]) {
  let state = {
    trades: new Map<string, any>(trades.map((t) => [t.id!, clone(t)])),
    evidence: [] as any[],
    reviews: [] as any[],
    outbox: [] as any[],
  };
  let seq = 0;
  const snapshot = () => clone({ ...state, trades: [...state.trades.entries()] });
  const restore = (s: any) => {
    state = { ...s, trades: new Map(s.trades) };
  };
  const reviveTrade = (t: any) => (t ? { ...clone(t), createdAt: new Date(t.createdAt) } : null);

  const manager = {
    findOne: jest.fn(async (entity: any, { where }: any) => {
      if (entity === Trade) return reviveTrade(state.trades.get(where.id));
      if (entity === OrderReconciliationReview) return clone(state.reviews.find((r) => r.id === where.id) ?? null);
      return null;
    }),
    save: jest.fn(async (entity: any, row: any) => {
      if (entity === Trade) state.trades.set(row.id, clone(row));
      if (entity === OrderReconciliationReview) state.reviews = state.reviews.map((r) => (r.id === row.id ? clone(row) : r));
      return row;
    }),
    insert: jest.fn(async (entity: any, row: any) => {
      if (entity === OrderReconciliationEvidence) state.evidence.push({ id: `ev-${++seq}`, ...clone(row) });
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: any) => Promise<any>) => {
      const s = snapshot();
      try {
        return await work(manager);
      } catch (e) {
        restore(s);
        throw e;
      }
    }),
  };
  const tradeRepo = {
    find: jest.fn(async () =>
      [...state.trades.values()]
        .filter((t) => RECONCILABLE_STATUSES.includes(t.status) && t.transactionHash)
        .map(reviveTrade),
    ),
  };
  const reviewRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      clone(state.reviews.find((r) => r.tradeId === where.tradeId && r.status === where.status) ?? null),
    ),
    insert: jest.fn(async (row: any) => {
      state.reviews.push({ id: `rev-${++seq}`, createdAt: NOW.toISOString(), ...clone(row) });
    }),
    update: jest.fn(async (where: any, patch: any) => {
      state.reviews = state.reviews.map((r) => (r.id === where.id && r.status === where.status ? { ...r, ...clone(patch) } : r));
    }),
    find: jest.fn(async ({ where }: any) => clone(state.reviews.filter((r) => r.status === where.status))),
  };
  const evidenceRepo = {
    find: jest.fn(async ({ where }: any) => clone(state.evidence.filter((e) => e.tradeId === where.tradeId))),
  };
  const outbox = { record: jest.fn(async (_m: any, type: string, payload: any) => state.outbox.push({ type, payload })) };
  const chainResults = new Map<string, ChainObservation[]>();
  const chain = { lookup: jest.fn(async (hash: string) => clone(chainResults.get(hash) ?? [])) };
  const config = { get: jest.fn((_k: string, d: unknown) => d) };

  const service = new PendingOrderReconciliationService(
    tradeRepo as any,
    evidenceRepo as any,
    reviewRepo as any,
    dataSource as any,
    chain as any,
    outbox as any,
    config as any,
  );
  return { service, get state() { return state; }, chainResults, chain, outbox, manager };
}

describe('PendingOrderReconciliationService (#1531)', () => {
  const recent = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
  const old = new Date(NOW.getTime() - GRACE_MS - 60_000).toISOString();
  const pending = (id: string, hash: string, createdAt = recent, extra: Partial<Trade> = {}) =>
    ({ id, userId: 'user-1', status: TradeStatus.PENDING, transactionHash: hash, createdAt, version: 1, ...extra }) as any;

  it('confirms an order every source reports as successful and records evidence', async () => {
    const h = createHarness([pending('t-ok', HASH)]);
    h.chainResults.set(HASH, [obs('h1', 'success'), obs('h2', 'success')]);

    const summary = await h.service.reconcile({ now: NOW });

    expect(summary).toMatchObject({ examined: 1, confirmed: 1, failed: 0, flaggedForReview: 0 });
    expect(h.state.trades.get('t-ok')).toMatchObject({ status: TradeStatus.CONFIRMED, ledger: 500, version: 2 });
    expect(h.state.evidence).toHaveLength(1);
    expect(h.state.evidence[0]).toMatchObject({
      tradeId: 't-ok',
      fromStatus: TradeStatus.PENDING,
      toStatus: TradeStatus.CONFIRMED,
      rule: 'R7_all_sources_success',
      actorId: 'system',
      runId: summary.runId,
    });
    expect(h.state.evidence[0].observations).toHaveLength(2);
    expect(h.state.outbox[0]).toMatchObject({ type: 'trade.reconciled' });
  });

  it('fails an order every source reports as failed on-chain', async () => {
    const h = createHarness([pending('t-bad', HASH, recent, { status: TradeStatus.EXECUTING })]);
    h.chainResults.set(HASH, [obs('h1', 'failed', { resultCode: 'tx_failed' })]);

    const summary = await h.service.reconcile({ now: NOW });

    expect(summary.failed).toBe(1);
    expect(h.state.trades.get('t-bad')).toMatchObject({
      status: TradeStatus.FAILED,
      failureCode: TradeFailureCode.PROVIDER_REJECTED,
    });
    expect(h.state.evidence[0]).toMatchObject({ fromStatus: TradeStatus.EXECUTING, toStatus: TradeStatus.FAILED });
  });

  it('leaves a missing transaction pending within the grace period, then surfaces it for review', async () => {
    const h = createHarness([pending('t-young', HASH), pending('t-old', 'c'.repeat(64), old)]);
    h.chainResults.set(HASH, [obs('h1', 'not_found')]);
    h.chainResults.set('c'.repeat(64), [obs('h1', 'not_found')]);

    const summary = await h.service.reconcile({ now: NOW });

    expect(summary).toMatchObject({ deferred: 1, flaggedForReview: 1, confirmed: 0, failed: 0 });
    expect(h.state.trades.get('t-young').status).toBe(TradeStatus.PENDING);
    expect(h.state.trades.get('t-old').status).toBe(TradeStatus.PENDING); // not guessed
    expect(h.state.evidence).toHaveLength(0);
    expect(h.state.reviews).toEqual([
      expect.objectContaining({ tradeId: 't-old', reason: ReviewReason.MISSING_BEYOND_GRACE, status: 'open' }),
    ]);
  });

  it('surfaces conflicting results for review without changing the order', async () => {
    const h = createHarness([pending('t-conflict', HASH)]);
    h.chainResults.set(HASH, [obs('h1', 'success'), obs('h2', 'failed')]);

    const summary = await h.service.reconcile({ now: NOW });

    expect(summary.flaggedForReview).toBe(1);
    expect(h.state.trades.get('t-conflict')).toMatchObject({ status: TradeStatus.PENDING, version: 1 });
    expect(h.state.evidence).toHaveLength(0);
    expect(h.state.reviews[0]).toMatchObject({ reason: ReviewReason.CONFLICTING_OUTCOMES, occurrences: 1 });
    expect(h.state.reviews[0].observations).toHaveLength(2);
  });

  it('defers when sources are unavailable', async () => {
    const h = createHarness([pending('t-down', HASH)]);
    h.chainResults.set(HASH, [obs('h1', 'error'), obs('h2', 'error')]);
    const summary = await h.service.reconcile({ now: NOW });
    expect(summary.deferred).toBe(1);
    expect(h.state.trades.get('t-down').status).toBe(TradeStatus.PENDING);
  });

  describe('safe to rerun', () => {
    it('does not re-apply transitions or duplicate evidence/reviews', async () => {
      const h = createHarness([pending('t-ok', HASH), pending('t-conflict', 'd'.repeat(64))]);
      h.chainResults.set(HASH, [obs('h1', 'success')]);
      h.chainResults.set('d'.repeat(64), [obs('h1', 'success', { hash: 'd'.repeat(64) }), obs('h2', 'failed', { hash: 'd'.repeat(64) })]);

      await h.service.reconcile({ now: NOW });
      const second = await h.service.reconcile({ now: NOW });
      await h.service.reconcile({ now: NOW });

      expect(second).toMatchObject({ examined: 1, confirmed: 0, flaggedForReview: 1 });
      expect(h.state.evidence).toHaveLength(1);
      expect(h.state.reviews).toHaveLength(1);
      expect(h.state.reviews[0].occurrences).toBe(3);
      expect(h.state.trades.get('t-ok').version).toBe(2);
    });

    it('skips an order that was resolved concurrently after it was read', async () => {
      const h = createHarness([pending('t-race', HASH)]);
      h.chainResults.set(HASH, [obs('h1', 'success')]);
      // Another worker confirms the order between the candidate read and the lock.
      h.chain.lookup.mockImplementationOnce(async () => {
        h.state.trades.get('t-race').status = TradeStatus.SETTLED;
        return [obs('h1', 'success')];
      });

      const summary = await h.service.reconcile({ now: NOW });

      expect(summary).toMatchObject({ skipped: 1, confirmed: 0 });
      expect(h.state.trades.get('t-race').status).toBe(TradeStatus.SETTLED);
      expect(h.state.evidence).toHaveLength(0);
    });

    it('rolls back the transition if writing evidence fails', async () => {
      const h = createHarness([pending('t-ok', HASH)]);
      h.chainResults.set(HASH, [obs('h1', 'success')]);
      h.outbox.record.mockRejectedValueOnce(new Error('outbox down'));

      const summary = await h.service.reconcile({ now: NOW });

      expect(summary.items[0]).toMatchObject({ outcome: 'deferred', rule: 'E1_internal_error' });
      expect(h.state.trades.get('t-ok')).toMatchObject({ status: TradeStatus.PENDING, version: 1 });
      expect(h.state.evidence).toHaveLength(0);
    });
  });

  describe('operator review workflow', () => {
    async function flagged() {
      const h = createHarness([pending('t-conflict', HASH)]);
      h.chainResults.set(HASH, [obs('h1', 'success'), obs('h2', 'failed')]);
      await h.service.reconcile({ now: NOW });
      return h;
    }

    it('does not auto-apply a later clean result while a review is open', async () => {
      const h = await flagged();
      h.chainResults.set(HASH, [obs('h1', 'success'), obs('h2', 'success')]);
      const summary = await h.service.reconcile({ now: NOW });
      expect(summary.awaitingReview).toBe(1);
      expect(h.state.trades.get('t-conflict').status).toBe(TradeStatus.PENDING);
    });

    it('applies the operator decision with attributed evidence and closes the review', async () => {
      const h = await flagged();
      const reviewId = h.state.reviews[0].id;

      const resolved = await h.service.resolveReview(reviewId, { decision: 'confirm', note: 'Verified on stellar.expert' }, 'ops-1');

      expect(resolved).toMatchObject({ status: 'resolved', resolution: 'confirmed', resolvedBy: 'ops-1' });
      expect(h.state.trades.get('t-conflict').status).toBe(TradeStatus.CONFIRMED);
      expect(h.state.evidence[0]).toMatchObject({
        actorId: 'ops-1',
        rule: `operator_resolution:${ReviewReason.CONFLICTING_OUTCOMES}`,
        note: 'Verified on stellar.expert',
        runId: null,
      });
      await expect(
        h.service.resolveReview(reviewId, { decision: 'fail', note: 'second try' }, 'ops-2'),
      ).rejects.toThrow(ConflictException);
    });

    it('dismissing leaves the order untouched', async () => {
      const h = await flagged();
      await h.service.resolveReview(h.state.reviews[0].id, { decision: 'dismiss', note: 'Wait for next run' }, 'ops-1');
      expect(h.state.trades.get('t-conflict').status).toBe(TradeStatus.PENDING);
      expect(h.state.evidence).toHaveLength(0);
    });
  });
});
