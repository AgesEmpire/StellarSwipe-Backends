import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConditionalOrder } from '../conditional-order.entity';
import { ConditionalOrderSide, ConditionalOrderStatus } from '../dto/create-conditional-order.dto';
import { ConditionalOrderRevision } from './conditional-order-revision.entity';
import { OrderAmendmentService } from './order-amendment.service';
import { ForbiddenResourceException } from '../../../common/exceptions/forbidden-resource.exception';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const tick = () => new Promise((r) => setImmediate(r));

/**
 * In-memory store with transactional semantics close enough to Postgres for
 * these tests: transactions are serialized (as the pessimistic row lock
 * serializes them on one order), and a thrown error restores the snapshot
 * taken at transaction start (rollback).
 */
function createStore(initialOrders: Partial<ConditionalOrder>[]) {
  const state = {
    orders: new Map<string, any>(initialOrders.map((o) => [o.id!, clone(o)])),
    revisions: [] as any[],
    outbox: [] as any[],
  };
  let seq = 0;
  let lock: Promise<unknown> = Promise.resolve();

  const reviveOrder = (o: any) => (o ? { ...clone(o), expiresAt: o.expiresAt ? new Date(o.expiresAt) : undefined } : null);

  const manager = {
    findOne: jest.fn(async (entity: any, opts: any) => {
      await tick();
      if (entity === ConditionalOrder) return reviveOrder(state.orders.get(opts.where.id));
      const rows = state.revisions
        .filter((r) => r.orderId === opts.where.orderId)
        .sort((a, b) => b.revisionNumber - a.revisionNumber);
      return rows[0] ? clone(rows[0]) : null;
    }),
    save: jest.fn(async (_entity: any, order: any) => {
      await tick();
      const saved = { ...clone(order), version: order.version + 1 };
      state.orders.set(order.id, saved);
      return reviveOrder(saved);
    }),
    create: jest.fn((_entity: any, data: any) => ({ ...data })),
    insert: jest.fn(async (_entity: any, row: any) => {
      await tick();
      if (state.revisions.some((r) => r.orderId === row.orderId && r.revisionNumber === row.revisionNumber)) {
        throw new Error('duplicate key value violates unique constraint');
      }
      row.id = `rev-${++seq}`;
      state.revisions.push(clone(row));
    }),
  };

  const atomic = {
    run: jest.fn(<T>(work: (qr: any) => Promise<T>): Promise<T> => {
      const result = lock.then(async () => {
        const snapshot = clone({ orders: [...state.orders.entries()], revisions: state.revisions, outbox: state.outbox });
        try {
          return await work({ manager });
        } catch (err) {
          state.orders = new Map(snapshot.orders);
          state.revisions = snapshot.revisions;
          state.outbox = snapshot.outbox;
          throw err;
        }
      });
      lock = result.catch(() => undefined);
      return result;
    }),
  };

  const outbox = {
    record: jest.fn(async (_m: any, type: string, payload: any, key: string) => {
      state.outbox.push({ type, payload, key });
    }),
  };

  const orderRepo = { findOne: jest.fn(async ({ where }: any) => reviveOrder(state.orders.get(where.id))) };
  const revisionRepo = {
    find: jest.fn(async ({ where }: any) =>
      clone(state.revisions.filter((r) => r.orderId === where.orderId).sort((a, b) => a.revisionNumber - b.revisionNumber)),
    ),
  };

  return { state, manager, atomic, outbox, orderRepo, revisionRepo };
}

describe('OrderAmendmentService (#1529)', () => {
  const owner = { id: 'user-1' };
  const baseOrder: Partial<ConditionalOrder> = {
    id: 'order-1',
    userId: 'user-1',
    side: ConditionalOrderSide.BUY,
    sellingAssetCode: 'USDC',
    buyingAssetCode: 'XLM',
    amount: '100.00000000' as any, // decimals come back from PG as strings
    limitPrice: '0.50000000' as any,
    conditions: [{ operator: 'AND', conditions: [{ type: 'PRICE_BELOW', value: 0.45 }] }] as any,
    status: ConditionalOrderStatus.PENDING,
    version: 1,
  };

  let store: ReturnType<typeof createStore>;
  let service: OrderAmendmentService;

  beforeEach(() => {
    store = createStore([baseOrder]);
    service = new OrderAmendmentService(
      store.orderRepo as any,
      store.revisionRepo as any,
      store.atomic as any,
      store.outbox as any,
    );
  });

  it('records actor, timestamp, reason and only the changed fields', async () => {
    const before = Date.now();
    const { order, revision } = await service.amend(
      'order-1',
      { reason: 'Tighten limit after news', amount: 100, limitPrice: 0.42 },
      { id: 'user-1', roles: ['user'] },
    );

    expect(order.version).toBe(2);
    expect(revision).toMatchObject({
      orderId: 'order-1',
      revisionNumber: 1,
      actorId: 'user-1',
      actorRoles: ['user'],
      reason: 'Tighten limit after news',
      orderVersionBefore: 1,
      orderVersionAfter: 2,
      // amount=100 was requested but equals the stored "100.00000000", so it is not a change
      changedFields: { limitPrice: { previous: 0.5, requested: 0.42 } },
      requestedValues: { amount: 100, limitPrice: 0.42 },
    });
    expect(new Date(revision.amendedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(store.state.revisions).toHaveLength(1);
    expect(store.state.outbox[0]).toMatchObject({
      type: 'conditional_order.amended',
      key: 'conditional_order.amended:order-1:1',
    });
  });

  describe('rejected amendments create no revision', () => {
    it.each([
      ['missing reason', { amount: 5 } as any, BadRequestException],
      ['blank reason', { reason: '   ', amount: 5 }, BadRequestException],
      ['no amendable fields', { reason: 'nothing to do' }, BadRequestException],
      ['non-positive amount', { reason: 'bad amount', amount: 0 }, BadRequestException],
      ['invalid expiry', { reason: 'bad expiry', expiresAt: 'not-a-date' }, BadRequestException],
      ['no effective change', { reason: 'same values', amount: 100, limitPrice: 0.5 }, BadRequestException],
      ['stale expectedVersion', { reason: 'stale read', amount: 5, expectedVersion: 7 }, ConflictException],
    ])('%s', async (_label, input, errorType) => {
      await expect(service.amend('order-1', input, owner)).rejects.toThrow(errorType);
      expect(store.state.revisions).toHaveLength(0);
      expect(store.state.outbox).toHaveLength(0);
      expect(store.state.orders.get('order-1').version).toBe(1);
    });

    it('rejects amendments of a terminal order', async () => {
      store.state.orders.get('order-1').status = ConditionalOrderStatus.FILLED;
      await expect(service.amend('order-1', { reason: 'too late', amount: 5 }, owner)).rejects.toThrow(
        BadRequestException,
      );
      expect(store.state.revisions).toHaveLength(0);
    });

    it('rejects another user and records nothing', async () => {
      await expect(service.amend('order-1', { reason: 'not mine', amount: 5 }, { id: 'user-2' })).rejects.toThrow(
        ForbiddenResourceException,
      );
      expect(store.state.revisions).toHaveLength(0);
    });

    it('rolls back the order update when writing the revision fails', async () => {
      store.outbox.record.mockRejectedValueOnce(new Error('outbox down'));
      await expect(service.amend('order-1', { reason: 'will fail', amount: 5 }, owner)).rejects.toThrow('outbox down');
      expect(store.state.revisions).toHaveLength(0);
      expect(store.state.orders.get('order-1')).toMatchObject({ amount: '100.00000000', version: 1 });
    });

    it('returns 404 for an unknown order', async () => {
      await expect(service.amend('missing', { reason: 'who?', amount: 5 }, owner)).rejects.toThrow(NotFoundException);
    });
  });

  describe('concurrent amendments', () => {
    it('serializes amendments into gap-free revisions whose previous values chain', async () => {
      const results = await Promise.all([
        service.amend('order-1', { reason: 'first', amount: 110 }, owner),
        service.amend('order-1', { reason: 'second', amount: 120 }, owner),
        service.amend('order-1', { reason: 'third', amount: 130 }, owner),
      ]);

      expect(results.map((r) => r.revision.revisionNumber).sort()).toEqual([1, 2, 3]);
      const history = await service.listRevisions('order-1', owner);
      expect(history.map((r) => r.revisionNumber)).toEqual([1, 2, 3]);
      expect(history[0].changedFields.amount).toEqual({ previous: 100, requested: 110 });
      for (let i = 1; i < history.length; i++) {
        expect(history[i].changedFields.amount.previous).toBe(history[i - 1].changedFields.amount.requested);
        expect(history[i].orderVersionBefore).toBe(history[i - 1].orderVersionAfter);
      }
      expect(store.state.orders.get('order-1')).toMatchObject({ amount: 130, version: 4 });
    });

    it('lets only one of two amendments based on the same version win', async () => {
      const outcomes = await Promise.allSettled([
        service.amend('order-1', { reason: 'client A', amount: 111, expectedVersion: 1 }, owner),
        service.amend('order-1', { reason: 'client B', amount: 222, expectedVersion: 1 }, owner),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(store.state.revisions).toHaveLength(1);
      expect(store.state.revisions[0].reason).toBe('client A');
    });
  });

  describe('historical retrieval', () => {
    beforeEach(async () => {
      await service.amend('order-1', { reason: 'raise size', amount: 150 }, owner);
      await service.amend('order-1', { reason: 'add expiry', expiresAt: '2027-01-01T00:00:00.000Z' }, owner);
      await service.amend('order-1', { reason: 'new trigger', limitPrice: 0.4, conditionGroups: [{ conditions: [] }] as any }, owner);
    });

    it('reconstructs the original values at revision 0', async () => {
      const state = await service.getStateAtRevision('order-1', 0, owner);
      expect(state.revision).toBeNull();
      expect(state.values).toEqual({
        amount: 100,
        limitPrice: 0.5,
        conditions: baseOrder.conditions,
        expiresAt: null,
      });
    });

    it('reconstructs intermediate and latest revisions', async () => {
      const r1 = await service.getStateAtRevision('order-1', 1, owner);
      expect(r1.values).toMatchObject({ amount: 150, limitPrice: 0.5, expiresAt: null });
      expect(r1.revision?.reason).toBe('raise size');

      const r2 = await service.getStateAtRevision('order-1', 2, owner);
      expect(r2.values).toMatchObject({ amount: 150, limitPrice: 0.5, expiresAt: '2027-01-01T00:00:00.000Z' });

      const r3 = await service.getStateAtRevision('order-1', 3, owner);
      expect(r3.values).toEqual({
        amount: 150,
        limitPrice: 0.4,
        conditions: [{ conditions: [] }],
        expiresAt: '2027-01-01T00:00:00.000Z',
      });
    });

    it('rejects unknown revisions and foreign readers', async () => {
      await expect(service.getStateAtRevision('order-1', 4, owner)).rejects.toThrow(NotFoundException);
      await expect(service.getStateAtRevision('order-1', -1, owner)).rejects.toThrow(BadRequestException);
      await expect(service.listRevisions('order-1', { id: 'user-2' })).rejects.toThrow(ForbiddenResourceException);
      await expect(service.listRevisions('order-1', { id: 'ops', roles: ['admin'] })).resolves.toHaveLength(3);
    });
  });
});
