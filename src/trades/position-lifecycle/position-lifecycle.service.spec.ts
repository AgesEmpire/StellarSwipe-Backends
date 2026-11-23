import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import {
  PositionLifecycleEvent,
  PositionLifecycleEventType as T,
  PositionLifecycleSource,
} from './position-lifecycle-event.entity';
import { PositionLifecycleService, RecordTransitionInput } from './position-lifecycle.service';
import { PositionLifecycleSubscriber, transitionForPositionUpdate } from './position-lifecycle.subscriber';
import { ArchivedPosition } from '../../portfolio/entities/archived-position.entity';
import { ForbiddenResourceException } from '../../common/exceptions/forbidden-resource.exception';

const POS = '11111111-1111-4111-8111-111111111111';
const USER = 'user-1';
const at = (iso: string) => new Date(iso);

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v instanceof FindOperator) {
      if (v.type === 'between') {
        const [from, to] = v.value as unknown as Date[];
        return row[k] >= from && row[k] <= to;
      }
      if (v.type === 'in') return (v.value as unknown as unknown[]).includes(row[k]);
      throw new Error(`unsupported operator ${v.type}`);
    }
    return row[k] === v;
  });
}

function createHarness() {
  let rows: PositionLifecycleEvent[] = [];
  const savepoints = new Map<string, PositionLifecycleEvent[]>();
  let seq = 0;
  const copy = (list: PositionLifecycleEvent[]) => list.map((r) => ({ ...r }));

  const manager: any = {
    queryRunner: { isTransactionActive: true },
    query: jest.fn(async (sql: string) => {
      const [, cmd, name] = sql.match(/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) (\w+)/) ?? [];
      if (cmd === 'SAVEPOINT') savepoints.set(name, copy(rows));
      if (cmd === 'ROLLBACK TO SAVEPOINT') rows = copy(savepoints.get(name)!);
      return [];
    }),
    findOne: jest.fn(async (_e: any, { where }: any) => rows.find((r) => matches(r, where)) ?? null),
    find: jest.fn(async (_e: any, { where }: any) =>
      rows.filter((r) => matches(r, where)).sort((a, b) => a.sequence - b.sequence),
    ),
    create: jest.fn((_e: any, data: any) => ({ ...data })),
    insert: jest.fn(async (_e: any, row: any) => {
      if (rows.some((r) => r.idempotencyKey === row.idempotencyKey || (r.positionId === row.positionId && r.sequence === row.sequence))) {
        throw new Error('duplicate key value violates unique constraint');
      }
      row.id = `evt-${++seq}`;
      row.recordedAt = new Date();
      rows.push({ ...row });
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: any) => Promise<any>) => {
      const snapshot = copy(rows);
      try {
        return await work(manager);
      } catch (e) {
        rows = snapshot;
        throw e;
      }
    }),
  };
  const eventRepo = {
    find: jest.fn(async ({ where, order, take }: any) => {
      const found = rows.filter((r) => matches(r, where));
      found.sort((a, b) =>
        order?.occurredAt ? a.occurredAt.getTime() - b.occurredAt.getTime() || a.sequence - b.sequence : a.sequence - b.sequence,
      );
      return found.slice(0, take ?? found.length);
    }),
  };
  const service = new PositionLifecycleService(eventRepo as any, dataSource as any);
  return { service, manager, dataSource, get rows() { return rows; } };
}

const input = (type: T, occurredAt: string, key: string, extra: Partial<RecordTransitionInput> = {}): RecordTransitionInput => ({
  positionId: POS,
  userId: USER,
  type,
  occurredAt: at(occurredAt),
  source: PositionLifecycleSource.TRADE,
  idempotencyKey: key,
  ...extra,
});

describe('PositionLifecycleService (#1534)', () => {
  let h: ReturnType<typeof createHarness>;
  beforeEach(() => {
    h = createHarness();
  });

  it('records partial closes without ending the open cycle and exposes UTC timestamps', async () => {
    await h.service.recordTransition(input(T.OPENED, '2026-11-01T09:00:00+01:00', 'o', { quantityAfter: '10.00000000' }));
    await h.service.recordTransition(
      input(T.PARTIALLY_CLOSED, '2026-11-02T10:00:00Z', 'p1', { quantityBefore: '10.00000000', quantityAfter: '6.00000000' }),
    );
    await h.service.recordTransition(
      input(T.PARTIALLY_CLOSED, '2026-11-03T10:00:00Z', 'p2', { quantityBefore: '6.00000000', quantityAfter: '1.00000000' }),
    );

    let timeline = await h.service.getTimeline(POS, { id: USER });
    expect(timeline).toMatchObject({
      state: 'open',
      timezone: 'UTC',
      openedAt: '2026-11-01T08:00:00.000Z', // +01:00 normalized to UTC
      closedAt: null,
      cycles: [{ openedAt: '2026-11-01T08:00:00.000Z', partialCloseAts: ['2026-11-02T10:00:00.000Z', '2026-11-03T10:00:00.000Z'], closedAt: null }],
    });
    expect(timeline.events.map((e) => [e.type, e.quantityBefore, e.quantityAfter])).toEqual([
      [T.OPENED, null, '10.00000000'],
      [T.PARTIALLY_CLOSED, '10.00000000', '6.00000000'],
      [T.PARTIALLY_CLOSED, '6.00000000', '1.00000000'],
    ]);
    for (const e of timeline.events) {
      expect(e.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(e.recordedAt).toMatch(/Z$/);
    }

    await h.service.recordTransition(input(T.CLOSED, '2026-11-04T10:00:00Z', 'c', { quantityBefore: '1.00000000', quantityAfter: '0' }));
    timeline = await h.service.getTimeline(POS, { id: USER });
    expect(timeline).toMatchObject({ state: 'closed', closedAt: '2026-11-04T10:00:00.000Z' });
    await expect(h.service.recordTransition(input(T.PARTIALLY_CLOSED, '2026-11-05T00:00:00Z', 'p3'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('starts a new cycle on reopen and never alters earlier timestamps', async () => {
    await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
    await h.service.recordTransition(input(T.CLOSED, '2026-11-02T00:00:00Z', 'c1'));
    const firstCycleRows = h.rows.map((r) => ({ ...r }));

    await h.service.recordTransition(input(T.REOPENED, '2026-11-03T00:00:00Z', 'r'));
    await h.service.recordTransition(input(T.PARTIALLY_CLOSED, '2026-11-04T00:00:00Z', 'p'));
    await h.service.recordTransition(input(T.CLOSED, '2026-11-05T00:00:00Z', 'c2'));

    expect(h.rows.slice(0, 2)).toEqual(firstCycleRows);
    const timeline = await h.service.getTimeline(POS);
    expect(timeline.openedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(timeline.closedAt).toBe('2026-11-05T00:00:00.000Z');
    expect(timeline.cycles).toEqual([
      { openedAt: '2026-11-01T00:00:00.000Z', openedBy: T.OPENED, partialCloseAts: [], closedAt: '2026-11-02T00:00:00.000Z' },
      { openedAt: '2026-11-03T00:00:00.000Z', openedBy: T.REOPENED, partialCloseAts: ['2026-11-04T00:00:00.000Z'], closedAt: '2026-11-05T00:00:00.000Z' },
    ]);
    expect(timeline.events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects reopening an open position', async () => {
    await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
    await expect(h.service.recordTransition(input(T.REOPENED, '2026-11-02T00:00:00Z', 'r'))).rejects.toThrow(ConflictException);
  });

  describe('archival', () => {
    it('archives a closed position and makes it terminal', async () => {
      await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
      await h.service.recordTransition(input(T.CLOSED, '2026-11-02T00:00:00Z', 'c'));
      await h.service.recordTransition(input(T.ARCHIVED, '2026-12-01T00:00:00Z', 'a', { occurredAt: new Date(Date.now() - 1000) }));

      const timeline = await h.service.getTimeline(POS);
      expect(timeline.state).toBe('archived');
      expect(timeline.archivedAt).not.toBeNull();
      expect(timeline.closedAt).toBe('2026-11-02T00:00:00.000Z');
      for (const t of [T.REOPENED, T.OPENED, T.CLOSED, T.ARCHIVED]) {
        await expect(h.service.recordTransition(input(t, new Date().toISOString(), `after-${t}`))).rejects.toThrow(ConflictException);
      }
    });

    it('rejects archiving an open position', async () => {
      await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
      await expect(h.service.recordTransition(input(T.ARCHIVED, '2026-11-02T00:00:00Z', 'a'))).rejects.toThrow(ConflictException);
      expect(h.rows).toHaveLength(1);
    });

    it('back-fills an inferred CLOSED for a legacy position archived with no history', async () => {
      const result = await h.service.recordTransition(
        input(T.ARCHIVED, '2026-11-10T00:00:00Z', 'legacy-a', { backfill: { closedAt: at('2026-08-01T00:00:00Z') } }),
      );
      expect(result.inferred.map((e) => [e.eventType, e.inferred])).toEqual([[T.CLOSED, true]]);
      expect((await h.service.getTimeline(POS)).state).toBe('archived');
    });
  });

  it('back-fills OPENED when a pre-existing position is first closed', async () => {
    const result = await h.service.recordTransition(
      input(T.CLOSED, '2026-11-02T00:00:00Z', 'c', { backfill: { openedAt: at('2026-10-01T00:00:00Z') } }),
    );
    expect(result.inferred).toHaveLength(1);
    expect(h.rows.map((r) => [r.eventType, r.inferred, r.occurredAt.toISOString()])).toEqual([
      [T.OPENED, true, '2026-10-01T00:00:00.000Z'],
      [T.CLOSED, false, '2026-11-02T00:00:00.000Z'],
    ]);
  });

  it('rejects a close for a position with no history and no back-fill', async () => {
    await expect(h.service.recordTransition(input(T.CLOSED, '2026-11-02T00:00:00Z', 'c'))).rejects.toThrow(ConflictException);
  });

  it('is idempotent per key', async () => {
    const first = await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
    const replay = await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
    expect(first.created).toBe(true);
    expect(replay).toMatchObject({ created: false, event: { id: first.event.id } });
    expect(h.rows).toHaveLength(1);
  });

  it('rejects out-of-order and future timestamps', async () => {
    await h.service.recordTransition(input(T.OPENED, '2026-11-02T00:00:00Z', 'o'));
    await expect(h.service.recordTransition(input(T.CLOSED, '2026-11-01T00:00:00Z', 'c'))).rejects.toThrow(ConflictException);
    await expect(
      h.service.recordTransition(input(T.CLOSED, new Date(Date.now() + 60 * 60 * 1000).toISOString(), 'c2')),
    ).rejects.toThrow(BadRequestException);
  });

  it('safe variant never throws and rolls back to its savepoint inside a transaction', async () => {
    await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
    const result = await h.service.recordTransitionSafe(input(T.ARCHIVED, '2026-11-02T00:00:00Z', 'bad'), h.manager);
    expect(result).toBeNull();
    expect(h.rows).toHaveLength(1);
    expect(h.manager.query).toHaveBeenCalledWith(expect.stringMatching(/^ROLLBACK TO SAVEPOINT/));

    const ok = await h.service.recordTransitionSafe(input(T.CLOSED, '2026-11-02T00:00:00Z', 'c'), h.manager);
    expect(ok?.created).toBe(true);
    expect(h.manager.query).toHaveBeenCalledWith(expect.stringMatching(/^RELEASE SAVEPOINT/));
  });

  it('enforces ownership on reads', async () => {
    await expect(h.service.getTimeline(POS)).rejects.toThrow(NotFoundException);
    await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
    await expect(h.service.getTimeline(POS, { id: 'user-2' })).rejects.toThrow(ForbiddenResourceException);
    await expect(h.service.getTimeline(POS, { id: 'ops', roles: ['admin'] })).resolves.toBeDefined();
    await expect(h.service.listHistory(USER, {}, { id: 'user-2' })).rejects.toThrow(ForbiddenResourceException);
  });

  it('lists reporting history within [from, to) in UTC', async () => {
    await h.service.recordTransition(input(T.OPENED, '2026-11-01T00:00:00Z', 'o'));
    await h.service.recordTransition(input(T.PARTIALLY_CLOSED, '2026-11-02T00:00:00Z', 'p'));
    await h.service.recordTransition(input(T.CLOSED, '2026-11-03T00:00:00Z', 'c'));

    const window = await h.service.listHistory(USER, { from: at('2026-11-02T00:00:00Z'), to: at('2026-11-03T00:00:00Z') });
    expect(window.map((e) => e.type)).toEqual([T.PARTIALLY_CLOSED]);

    const closes = await h.service.listHistory(USER, { types: [T.CLOSED] });
    expect(closes.map((e) => e.occurredAt)).toEqual(['2026-11-03T00:00:00.000Z']);
    await expect(h.service.listHistory(USER, { from: at('2026-11-03T00:00:00Z'), to: at('2026-11-02T00:00:00Z') })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('PositionLifecycleSubscriber (#1534)', () => {
  it('derives transitions from portfolio Position updates without touching quantities', () => {
    expect(transitionForPositionUpdate({ isActive: true, amount: '10' }, { isActive: true, amount: '4' })).toBe(T.PARTIALLY_CLOSED);
    expect(transitionForPositionUpdate({ isActive: true, amount: '10' }, { isActive: false, amount: '10' })).toBe(T.CLOSED);
    expect(transitionForPositionUpdate({ isActive: false, amount: '10' }, { isActive: true, amount: '10' })).toBe(T.REOPENED);
    expect(transitionForPositionUpdate({ isActive: true, amount: '10' }, { isActive: true, amount: '12' })).toBeNull();
    expect(transitionForPositionUpdate({ isActive: true, amount: '10' }, { isActive: true, amount: '10' })).toBeNull();
  });

  it('records ARCHIVED when an archived_positions row is inserted', async () => {
    const lifecycle = { recordTransitionSafe: jest.fn().mockResolvedValue(null) };
    const dataSource = { subscribers: [] as unknown[] };
    const subscriber = new PositionLifecycleSubscriber(dataSource as any, lifecycle as any);
    expect(dataSource.subscribers).toContain(subscriber);

    const manager = {};
    await subscriber.afterInsert({
      metadata: { target: ArchivedPosition },
      manager,
      entity: {
        id: 'arch-1',
        originalPositionId: POS,
        userId: USER,
        closedAt: at('2026-08-01T00:00:00Z'),
        archivedAt: at('2026-11-01T00:00:00Z'),
      },
    } as any);

    expect(lifecycle.recordTransitionSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        positionId: POS,
        type: T.ARCHIVED,
        occurredAt: at('2026-11-01T00:00:00Z'),
        backfill: { closedAt: at('2026-08-01T00:00:00Z') },
      }),
      manager,
    );
  });
});
