import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { SignalCorrectionService } from './signal-correction.service';
import { SignalCorrectionEvent, SignalLifecycleEventType } from './signal-correction-event.entity';
import { Signal, SignalStatus } from '../entities/signal.entity';
import { SignalVersion } from '../versions/entities/signal-version.entity';

const SIGNAL = '22222222-2222-2222-2222-222222222222';
const PROVIDER = 'provider-1';

/** Minimal in-memory repository supporting equality + MoreThan filters and ordering. */
function memRepo(rows: any[]) {
  let seq = 0;
  const matches = (r: any, where: any = {}) =>
    Object.entries(where).every(([k, v]) =>
      v instanceof FindOperator
        ? v.type === 'moreThan'
          ? r[k] > (v as any).value
          : false
        : r[k] === v,
    );
  const sort = (list: any[], order?: Record<string, 'ASC' | 'DESC'>) => {
    if (!order) return list;
    const [[key, dir]] = Object.entries(order);
    return [...list].sort((a, b) => (dir === 'ASC' ? a[key] - b[key] : b[key] - a[key]));
  };
  return {
    rows,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      if (!x.id) x.id = `row-${++seq}-${Math.random().toString(36).slice(2, 7)}`;
      if (!x.createdAt) x.createdAt = new Date();
      const idx = rows.findIndex((r) => r.id === x.id);
      if (idx >= 0) rows[idx] = { ...x };
      else rows.push({ ...x });
      return { ...x };
    },
    findOne: async ({ where, order }: any) => {
      const found = sort(rows.filter((r) => matches(r, where)), order)[0];
      return found ? { ...found } : null;
    },
    find: async ({ where, order }: any) =>
      sort(rows.filter((r) => matches(r, where)), order).map((r) => ({ ...r })),
  };
}

function setup(signalOverrides: Partial<Signal> = {}) {
  const signals = memRepo([
    {
      id: SIGNAL,
      providerId: PROVIDER,
      status: SignalStatus.ACTIVE,
      entryPrice: '0.10',
      targetPrice: '0.15',
      stopLossPrice: '0.08',
      rationale: 'original',
      version: 1,
      ...signalOverrides,
    },
  ]);
  const versions = memRepo([]);
  const events = memRepo([]);
  const repoFor = (entity: unknown) =>
    entity === Signal ? signals : entity === SignalVersion ? versions : events;

  // Serialise transactions, mirroring the pessimistic row lock on the signal.
  let chain: Promise<unknown> = Promise.resolve();
  const dataSource = {
    transaction: (cb: (m: any) => Promise<any>) => {
      const run = chain.then(() => cb({ getRepository: repoFor }));
      chain = run.catch(() => undefined);
      return run;
    },
    getRepository: (entity: unknown) => {
      expect(entity).toBe(SignalCorrectionEvent);
      return events;
    },
  };
  const emitter = { emit: jest.fn() };
  const svc = new SignalCorrectionService(dataSource as any, emitter as any);
  return { svc, emitter, signals, versions, events };
}

describe('SignalCorrectionService (#1518)', () => {
  it('links previous and replacement versions, records the reason and a field diff', async () => {
    const { svc, versions, signals } = setup();
    const evt = await svc.correct(SIGNAL, PROVIDER, {
      reason: 'Target price typo',
      targetPrice: '0.18',
    });

    expect(evt.eventType).toBe(SignalLifecycleEventType.CORRECTED);
    expect(evt.previousVersion.number).toBe(1);
    expect(evt.replacementVersion.number).toBe(2);
    expect(evt.reason).toBe('Target price typo');
    expect(evt.changes).toEqual({ targetPrice: { from: '0.15', to: '0.18' } });

    const prev = versions.rows.find((v) => v.id === evt.previousVersion.id);
    const next = versions.rows.find((v) => v.id === evt.replacementVersion.id);
    expect(prev.targetPrice).toBe('0.15'); // baseline snapshot of published state
    expect(next.targetPrice).toBe('0.18');
    expect(next.entryPrice).toBe('0.10');
    expect(signals.rows[0]).toMatchObject({ targetPrice: '0.18', version: 2 });
  });

  it('emits signal.corrected (never signal.published) after commit', async () => {
    const { svc, emitter } = setup();
    await svc.correct(SIGNAL, PROVIDER, { reason: 'Fix stop loss', stopLossPrice: '0.07' });
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    const [name, payload] = emitter.emit.mock.calls[0];
    expect(name).toBe(SignalLifecycleEventType.CORRECTED);
    expect(name).not.toBe(SignalLifecycleEventType.PUBLISHED);
    expect(payload).toMatchObject({ eventType: 'signal.corrected', replayed: false });
  });

  describe('ordering', () => {
    it('assigns monotonic sequences and chains versions across successive corrections', async () => {
      const { svc } = setup();
      const a = await svc.correct(SIGNAL, PROVIDER, { reason: 'first fix', targetPrice: '0.16' });
      const b = await svc.correct(SIGNAL, PROVIDER, { reason: 'second fix', targetPrice: '0.17' });
      expect([a.sequence, b.sequence]).toEqual([1, 2]);
      expect(b.previousVersion.id).toBe(a.replacementVersion.id);
      expect(b.changes.targetPrice).toEqual({ from: '0.16', to: '0.17' });
    });

    it('keeps a gap-free order under concurrent corrections', async () => {
      const { svc } = setup();
      const results = await Promise.all(
        ['0.2', '0.3', '0.4'].map((p, i) =>
          svc.correct(SIGNAL, PROVIDER, { reason: `concurrent ${i}`, targetPrice: p }),
        ),
      );
      expect(results.map((r) => r.sequence).sort()).toEqual([1, 2, 3]);
      expect(results.map((r) => r.replacementVersion.number).sort()).toEqual([2, 3, 4]);
    });
  });

  describe('replay', () => {
    it('lists and re-emits stored corrections in order from a cursor', async () => {
      const { svc, emitter } = setup();
      await svc.correct(SIGNAL, PROVIDER, { reason: 'fix one', targetPrice: '0.16' });
      await svc.correct(SIGNAL, PROVIDER, { reason: 'fix two', targetPrice: '0.17' });
      await svc.correct(SIGNAL, PROVIDER, { reason: 'fix three', targetPrice: '0.19' });
      emitter.emit.mockClear();

      const replayed = await svc.replay(SIGNAL, 1);
      expect(replayed.map((r) => r.sequence)).toEqual([2, 3]);
      expect(replayed.every((r) => r.replayed)).toBe(true);
      expect(emitter.emit.mock.calls.map((c) => c[1].sequence)).toEqual([2, 3]);
    });

    it('is idempotent for a retried request with the same key', async () => {
      const { svc, emitter, events } = setup();
      const first = await svc.correct(SIGNAL, PROVIDER, {
        reason: 'retryable fix',
        targetPrice: '0.16',
        idempotencyKey: 'k-1',
      });
      const again = await svc.correct(SIGNAL, PROVIDER, {
        reason: 'retryable fix',
        targetPrice: '0.16',
        idempotencyKey: 'k-1',
      });
      expect(again.eventId).toBe(first.eventId);
      expect(events.rows).toHaveLength(1);
      expect(emitter.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('authorization and validation', () => {
    it('rejects corrections by a different provider without writing anything', async () => {
      const { svc, emitter, events, versions } = setup();
      await expect(
        svc.correct(SIGNAL, 'intruder', { reason: 'malicious edit', targetPrice: '9' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(events.rows).toHaveLength(0);
      expect(versions.rows).toHaveLength(0);
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('rejects an idempotency key replay from a non-owner', async () => {
      const { svc } = setup();
      await svc.correct(SIGNAL, PROVIDER, { reason: 'owner fix', targetPrice: '0.16', idempotencyKey: 'k' });
      await expect(
        svc.correct(SIGNAL, 'intruder', { reason: 'owner fix', targetPrice: '0.16', idempotencyKey: 'k' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires a reason and an actual change', async () => {
      const { svc } = setup();
      await expect(svc.correct(SIGNAL, PROVIDER, { reason: '', targetPrice: '1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(svc.correct(SIGNAL, PROVIDER, { reason: 'no fields' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        svc.correct(SIGNAL, PROVIDER, { reason: 'same value', targetPrice: '0.15' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown signals and closed signals', async () => {
      await expect(
        setup().svc.correct('missing', PROVIDER, { reason: 'whatever', targetPrice: '1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup({ status: SignalStatus.CLOSED }).svc.correct(SIGNAL, PROVIDER, {
          reason: 'too late',
          targetPrice: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
