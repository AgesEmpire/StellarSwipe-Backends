import { BadRequestException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { TradeSide, TradeStatus } from '../entities/trade.entity';
import { CloseAllPositionsService, OPEN_POSITION_STATUSES } from './close-all.service';
import { CloseQuote, CloseQuoteRequest, IneligibleReason } from './close-all.types';
import { estimateFill, slippageBps } from './orderbook-estimate';
import { ForbiddenResourceException } from '../../common/exceptions/forbidden-resource.exception';

const USER = 'user-1';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const tick = () => new Promise((r) => setImmediate(r));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const trade = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: USER,
  side: TradeSide.BUY,
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  amount: '100.00000000',
  entryPrice: '0.10000000',
  status: TradeStatus.COMPLETED,
  closedAt: null,
  version: 1,
  createdAt: NOW.toISOString(),
  ...extra,
});

function createHarness(initialTrades: any[], quoteOverrides: Record<string, CloseQuote | null> = {}) {
  const trades = new Map<string, any>(initialTrades.map((t) => [t.id, clone(t)]));
  const confirmations: any[] = [];
  let seq = 0;

  const tradeRepo = {
    find: jest.fn(async ({ where }: any) => {
      await tick();
      return [...trades.values()]
        .filter((t) => t.userId === where.userId && !t.closedAt && OPEN_POSITION_STATUSES.includes(t.status))
        .map(clone);
    }),
    save: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
  };
  const confirmationRepo = {
    findOne: jest.fn(async ({ where }: any) => {
      await tick();
      return clone(confirmations.find((c) => c.previewId === where.previewId) ?? null);
    }),
    create: jest.fn((data: any) => ({ ...data })),
    insert: jest.fn(async (row: any) => {
      await tick();
      if (confirmations.some((c) => c.previewId === row.previewId)) {
        throw Object.assign(new Error('duplicate key'), { driverError: { code: '23505' } });
      }
      row.id = `conf-${++seq}`;
      row.createdAt = new Date().toISOString();
      confirmations.push(clone(row));
    }),
    update: jest.fn(async ({ id }: any, patch: any) => {
      const row = confirmations.find((c) => c.id === id);
      Object.assign(row, clone(patch));
    }),
  };
  const defaultQuote: CloseQuote = { bestPrice: 0.12, averagePrice: 0.1194, sufficientLiquidity: true, source: 'test-book', asOf: NOW.toISOString() };
  const quotes = {
    quote: jest.fn(async (req: CloseQuoteRequest) => {
      await tick();
      return req.baseAsset in quoteOverrides ? quoteOverrides[req.baseAsset] : defaultQuote;
    }),
  };
  const closer = {
    close: jest.fn(async ({ tradeId, version }: any) => {
      await tick();
      const t = trades.get(tradeId);
      if (t.version !== version) throw new ConflictException('Trade was modified by another request');
      t.closedAt = NOW.toISOString();
      t.version += 1;
      return { exitPrice: '0.11940000', profitLoss: '1.94000000', transactionHash: `tx-${tradeId}` };
    }),
  };
  const settings: Record<string, unknown> = { CLOSE_ALL_PREVIEW_SECRET: 'test-secret', CLOSE_ALL_PLATFORM_FEE_BPS: 10 };
  const config = { get: jest.fn((k: string, d?: unknown) => (k in settings ? settings[k] : d)) };
  const service = new CloseAllPositionsService(
    tradeRepo as any,
    confirmationRepo as any,
    quotes as any,
    closer as any,
    config as any,
  );
  return { service, trades, confirmations, tradeRepo, confirmationRepo, quotes, closer, quoteOverrides };
}

describe('order book estimates', () => {
  it('converts bid depth (quoted in counter) to base and averages across levels', () => {
    // 10 base available at 2.0 (20 counter), then 10 base at 1.0 (10 counter)
    const fill = estimateFill([{ price: '2', amount: '20' }, { price: '1', amount: '10' }], 15, 'bids')!;
    expect(fill.sufficientLiquidity).toBe(true);
    expect(fill.averagePrice).toBeCloseTo((10 * 2 + 5 * 1) / 15);
    expect(slippageBps(fill.bestPrice, fill.averagePrice)).toBeCloseTo(1666.67, 1);
  });

  it('reports insufficient depth and handles empty books', () => {
    expect(estimateFill([{ price: '1', amount: '5' }], 10, 'asks')!.sufficientLiquidity).toBe(false);
    expect(estimateFill([], 10, 'asks')).toBeNull();
    expect(estimateFill([{ price: '1', amount: '5' }], 0, 'asks')).toBeNull();
  });
});

describe('CloseAllPositionsService (#1537)', () => {
  const portfolio = () => [
    trade('t-long'),
    trade('t-short', { side: TradeSide.SELL, baseAsset: 'AQUA', counterAsset: 'XLM', entryPrice: '0.01000000', amount: '1000.00000000' }),
    trade('t-pending', { status: TradeStatus.PENDING }),
    trade('t-settled', { status: TradeStatus.SETTLED }),
    trade('t-zero', { amount: '0' }),
    trade('t-noprice', { baseAsset: 'NOPRICE' }),
    trade('t-thin', { baseAsset: 'THIN' }),
    trade('t-closed', { closedAt: NOW.toISOString() }),
    trade('t-failed', { status: TradeStatus.FAILED }),
    trade('t-other-user', { userId: 'user-2' }),
  ];
  const overrides = () => ({
    NOPRICE: null,
    THIN: { bestPrice: 0.12, averagePrice: 0.11, sufficientLiquidity: false, source: 'test-book', asOf: NOW.toISOString() },
    AQUA: { bestPrice: 0.009, averagePrice: 0.0091, sufficientLiquidity: true, source: 'test-book', asOf: NOW.toISOString() },
  });

  describe('preview', () => {
    it('lists eligible positions with estimated fees/slippage and ineligible ones with reasons', async () => {
      const h = createHarness(portfolio(), overrides());
      const preview = await h.service.preview(USER, { id: USER }, NOW);

      expect(preview.eligible.map((p) => p.positionId)).toEqual(['t-long', 't-short']);
      expect(preview.eligible[0]).toMatchObject({
        estimatedExitPrice: '0.11940000',
        bestPrice: '0.12000000',
        estimatedSlippageBps: 50,
        estimatedSlippageCost: '0.06000000', // (0.12 - 0.1194) * 100
        estimatedNotional: '11.94000000',
        estimatedPlatformFee: '0.01194000', // 10 bps
        estimatedNetworkFeeXlm: '0.00001000',
        estimatedRealizedPnl: '1.92806000', // (0.1194 - 0.1) * 100 - fee
      });
      // SELL position: PnL = (entry - exit) * amount, quoted on the ask side
      expect(h.quotes.quote).toHaveBeenCalledWith(expect.objectContaining({ baseAsset: 'AQUA', direction: 'buy_base' }));
      expect(preview.eligible[1].estimatedRealizedPnl).toBe(fx((0.01 - 0.0091) * 1000 - 0.0091 * 1000 * 0.001));

      expect(Object.fromEntries(preview.ineligible.map((p) => [p.positionId, p.reason]))).toEqual({
        't-pending': IneligibleReason.PENDING_SETTLEMENT,
        't-settled': IneligibleReason.UNSUPPORTED_STATUS,
        't-zero': IneligibleReason.ZERO_QUANTITY,
        't-noprice': IneligibleReason.PRICE_UNAVAILABLE,
        't-thin': IneligibleReason.INSUFFICIENT_LIQUIDITY,
      });
      expect(preview.totals.map((t) => [t.counterAsset, t.positions])).toEqual([
        ['USDC', 1],
        ['XLM', 1],
      ]);
      expect(preview.estimatedNetworkFeeXlm).toBe('0.00002000');
      expect(new Date(preview.expiresAt).getTime() - NOW.getTime()).toBe(60_000);
      expect(preview.previewToken).toMatch(/^[\w-]+\.[\w-]+$/);
    });

    it('has no side effects', async () => {
      const h = createHarness(portfolio(), overrides());
      const before = clone([...h.trades.entries()]);

      const first = await h.service.preview(USER, { id: USER }, NOW);
      const second = await h.service.preview(USER, { id: USER }, NOW);

      for (const write of ['save', 'update', 'insert', 'delete', 'remove'] as const) {
        expect(h.tradeRepo[write]).not.toHaveBeenCalled();
      }
      expect(h.confirmationRepo.insert).not.toHaveBeenCalled();
      expect(h.confirmationRepo.update).not.toHaveBeenCalled();
      expect(h.confirmationRepo.findOne).not.toHaveBeenCalled();
      expect(h.closer.close).not.toHaveBeenCalled();
      expect(clone([...h.trades.entries()])).toEqual(before);
      expect(h.confirmations).toHaveLength(0);
      // Deterministic for an unchanged portfolio; each preview gets its own id.
      expect(second.fingerprint).toBe(first.fingerprint);
      expect(second.previewId).not.toBe(first.previewId);
    });

    it("rejects previewing another user's portfolio", async () => {
      const h = createHarness(portfolio());
      await expect(h.service.preview(USER, { id: 'user-2' }, NOW)).rejects.toThrow(ForbiddenResourceException);
    });
  });

  describe('confirm', () => {
    it('closes exactly the previewed eligible positions', async () => {
      const h = createHarness(portfolio(), overrides());
      const preview = await h.service.preview(USER, { id: USER }, NOW);
      const result = await h.service.confirm(USER, preview.previewToken, { id: USER }, new Date(NOW.getTime() + 5_000));

      expect(result).toMatchObject({ status: 'completed', replayed: false, requested: 2, closed: 2, failed: 0 });
      expect(h.closer.close.mock.calls.map(([c]) => c)).toEqual([
        { tradeId: 't-long', userId: USER, version: 1 },
        { tradeId: 't-short', userId: USER, version: 1 },
      ]);
      expect(h.trades.get('t-pending').closedAt).toBeNull();
      expect(h.confirmations[0]).toMatchObject({ previewId: preview.previewId, status: 'completed' });
    });

    it('is idempotent: repeating the confirmation replays the original result', async () => {
      const h = createHarness(portfolio(), overrides());
      const preview = await h.service.preview(USER, { id: USER }, NOW);
      const first = await h.service.confirm(USER, preview.previewToken, undefined, NOW);
      // Even after the preview would have expired.
      const again = await h.service.confirm(USER, preview.previewToken, undefined, new Date(NOW.getTime() + 3_600_000));

      expect(again).toEqual({ ...first, replayed: true });
      expect(h.closer.close).toHaveBeenCalledTimes(2);
      expect(h.confirmations).toHaveLength(1);
    });

    it('executes once when the same preview is confirmed concurrently', async () => {
      const h = createHarness(portfolio(), overrides());
      const preview = await h.service.preview(USER, { id: USER }, NOW);

      const [a, b] = await Promise.all([
        h.service.confirm(USER, preview.previewToken, undefined, NOW),
        h.service.confirm(USER, preview.previewToken, undefined, NOW),
      ]);

      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(a.confirmationId).toBe(b.confirmationId);
      expect(h.closer.close).toHaveBeenCalledTimes(2);
      expect(h.confirmations).toHaveLength(1);
    });

    it('rejects an expired preview without executing', async () => {
      const h = createHarness(portfolio(), overrides());
      const preview = await h.service.preview(USER, undefined, NOW);
      await expect(h.service.confirm(USER, preview.previewToken, undefined, new Date(NOW.getTime() + 61_000))).rejects.toThrow(
        GoneException,
      );
      expect(h.closer.close).not.toHaveBeenCalled();
      expect(h.confirmations).toHaveLength(0);
    });

    describe('rejects a materially changed portfolio without executing', () => {
      const expectStale = async (h: ReturnType<typeof createHarness>, token: string, reason: string) => {
        const err = await h.service.confirm(USER, token, undefined, NOW).catch((e) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getResponse()).toMatchObject({ code: 'CLOSE_ALL_PREVIEW_STALE', reason });
        expect(h.closer.close).not.toHaveBeenCalled();
        expect(h.confirmations).toHaveLength(0);
        return err.getResponse();
      };

      it('a position was opened after the preview', async () => {
        const h = createHarness(portfolio(), overrides());
        const preview = await h.service.preview(USER, undefined, NOW);
        h.trades.set('t-new', trade('t-new'));
        expect(await expectStale(h, preview.previewToken, 'positions_changed')).toMatchObject({ added: ['t-new'] });
      });

      it('a previewed position was modified or closed', async () => {
        const h = createHarness(portfolio(), overrides());
        const preview = await h.service.preview(USER, undefined, NOW);
        Object.assign(h.trades.get('t-long'), { amount: '40.00000000', version: 2 });
        h.trades.get('t-short').closedAt = NOW.toISOString();
        expect(await expectStale(h, preview.previewToken, 'positions_changed')).toMatchObject({
          modified: ['t-long'],
          removed: ['t-short'],
        });
      });

      it('an ineligible position became eligible', async () => {
        const h = createHarness(portfolio(), overrides());
        const preview = await h.service.preview(USER, undefined, NOW);
        h.trades.get('t-pending').status = TradeStatus.COMPLETED;
        await expectStale(h, preview.previewToken, 'positions_changed');
      });

      it('the estimated exit price moved beyond the drift limit', async () => {
        const h = createHarness(portfolio(), overrides());
        const preview = await h.service.preview(USER, undefined, NOW);
        h.quoteOverrides.AQUA = { ...(h.quoteOverrides.AQUA as CloseQuote), averagePrice: 0.0095 }; // ~440 bps
        const body = await expectStale(h, preview.previewToken, 'price_moved');
        expect(body.positions.map((p: any) => p.positionId)).toEqual(['t-short']);
      });
    });

    it('tolerates small price moves within the drift limit', async () => {
      const h = createHarness(portfolio(), overrides());
      const preview = await h.service.preview(USER, undefined, NOW);
      h.quoteOverrides.AQUA = { ...(h.quoteOverrides.AQUA as CloseQuote), averagePrice: 0.00911 }; // ~11 bps
      await expect(h.service.confirm(USER, preview.previewToken, undefined, NOW)).resolves.toMatchObject({ closed: 2 });
    });

    it('rejects tampered, foreign and empty previews', async () => {
      const h = createHarness(portfolio(), overrides());
      const preview = await h.service.preview(USER, undefined, NOW);
      const [body, sig] = preview.previewToken.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), exp: 9e15 })).toString('base64url');

      await expect(h.service.confirm(USER, `${forged}.${sig}`, undefined, NOW)).rejects.toThrow(BadRequestException);
      await expect(h.service.confirm(USER, 'garbage', undefined, NOW)).rejects.toThrow(BadRequestException);
      await expect(h.service.confirm('user-2', preview.previewToken, undefined, NOW)).rejects.toThrow(ForbiddenException);

      const empty = createHarness([trade('only-pending', { status: TradeStatus.PENDING })]);
      const emptyPreview = await empty.service.preview(USER, undefined, NOW);
      expect(emptyPreview.eligible).toHaveLength(0);
      await expect(empty.service.confirm(USER, emptyPreview.previewToken, undefined, NOW)).rejects.toThrow(BadRequestException);
      expect(h.closer.close).not.toHaveBeenCalled();
    });

    it('records per-position failures without aborting the rest', async () => {
      const h = createHarness(portfolio(), overrides());
      const preview = await h.service.preview(USER, undefined, NOW);
      h.closer.close.mockRejectedValueOnce(new BadRequestException('Failed to close trade'));

      const result = await h.service.confirm(USER, preview.previewToken, undefined, NOW);

      expect(result).toMatchObject({ status: 'completed_with_failures', closed: 1, failed: 1 });
      expect(result.results[0]).toEqual({ positionId: 't-long', status: 'failed', error: 'Failed to close trade' });
      expect(result.results[1]).toMatchObject({ positionId: 't-short', status: 'closed' });
    });
  });
});

function fx(n: number) {
  return n.toFixed(8);
}
