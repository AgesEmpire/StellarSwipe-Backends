import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Contest, ContestMetric, ContestStatus } from './entities/contest.entity';
import {
  ContestEventDisposition,
  ContestResultCorrection,
  ContestTradeEvent,
} from './entities/contest-trade-event.entity';
import { classifyContestEvent, ingestionCutoff } from './contest-event-cutoff.policy';
import { ContestResultIntegrityService } from './contest-result-integrity.service';

type Row = Record<string, any>;

function fakeRepo<T extends Row>(uniqueKeys?: string[]) {
  const rows: T[] = [];
  let seq = 0;
  const match = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && (v as any)._type === 'in') {
        return (v as any)._value.includes(row[k]);
      }
      return row[k] === v;
    });
  return {
    rows,
    create: jest.fn((d: Partial<T>) => ({ ...d }) as T),
    insert: jest.fn(async (e: T) => {
      if (uniqueKeys && rows.some((r) => uniqueKeys.every((k) => r[k] === (e as Row)[k]))) {
        throw new Error('duplicate key value violates unique constraint');
      }
      (e as Row).id = (e as Row).id ?? `id-${++seq}`;
      rows.push({ ...e });
    }),
    save: jest.fn(async (e: T | T[]) => {
      for (const item of Array.isArray(e) ? e : [e]) {
        const i = rows.findIndex((r) => r.id === (item as Row).id);
        if (i >= 0) rows[i] = { ...item };
        else rows.push({ ...item });
      }
      return e;
    }),
    findOne: jest.fn(async ({ where }: { where: Row }) => {
      const r = rows.find((x) => match(x, where));
      return r ? { ...r } : null;
    }),
    find: jest.fn(async ({ where }: { where: Row }) =>
      rows.filter((x) => match(x, where)).map((r) => ({ ...r })),
    ),
  };
}

describe('Contest result integrity (#1524)', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-11-08T00:00:00Z');
  const minutes = (n: number) => n * 60 * 1000;
  const admin = { id: 'admin-1', roles: ['admin'] };

  let contests: ReturnType<typeof fakeRepo<Contest>>;
  let events: ReturnType<typeof fakeRepo<ContestTradeEvent>>;
  let corrections: ReturnType<typeof fakeRepo<ContestResultCorrection>>;
  let service: ContestResultIntegrityService;

  const contestRow = () => contests.rows[0];

  beforeEach(() => {
    contests = fakeRepo<Contest>();
    events = fakeRepo<ContestTradeEvent>(['contestId', 'eventId']);
    corrections = fakeRepo<ContestResultCorrection>(['contestId', 'toRevision']);
    contests.rows.push({
      id: 'c1',
      name: 'Weekly',
      startTime: start,
      endTime: end,
      metric: ContestMetric.HIGHEST_ROI,
      minSignals: 1,
      prizePool: '0',
      status: ContestStatus.ACTIVE,
      winners: null,
      finalizedAt: null,
      publishedScores: null,
      resultRevision: 0,
    } as unknown as Contest);
    service = new ContestResultIntegrityService(
      contests as any,
      events as any,
      corrections as any,
    );
  });

  const ingest = (eventId: string, eventTime: Date, ingestedAt: Date, scoreDelta = 10, providerId = 'p1') =>
    service.ingestTradeEvent({ contestId: 'c1', eventId, providerId, eventTime, ingestedAt, scoreDelta });

  describe('cutoff policy', () => {
    const contest = { startTime: start, endTime: end, finalizedAt: null, status: ContestStatus.ACTIVE };

    it('uses inclusive start / exclusive end on event time', () => {
      expect(classifyContestEvent(contest, { eventTime: start, ingestedAt: start })).toBe(
        ContestEventDisposition.ACCEPTED,
      );
      expect(classifyContestEvent(contest, { eventTime: end, ingestedAt: end })).toBe(
        ContestEventDisposition.EXCLUDED_OUT_OF_WINDOW,
      );
      expect(
        classifyContestEvent(contest, { eventTime: new Date(start.getTime() - 1), ingestedAt: start }),
      ).toBe(ContestEventDisposition.EXCLUDED_OUT_OF_WINDOW);
    });

    it('applies the ingestion cutoff of endTime + grace, or finalizedAt if earlier', () => {
      const inWindow = new Date(end.getTime() - 1);
      expect(
        classifyContestEvent(contest, { eventTime: inWindow, ingestedAt: new Date(end.getTime() + minutes(5)) }),
      ).toBe(ContestEventDisposition.ACCEPTED);
      expect(
        classifyContestEvent(contest, { eventTime: inWindow, ingestedAt: new Date(end.getTime() + minutes(5) + 1) }),
      ).toBe(ContestEventDisposition.PENDING_CORRECTION);

      const finalizedEarly = { ...contest, finalizedAt: new Date(end.getTime() + minutes(1)) };
      expect(ingestionCutoff(finalizedEarly).toISOString()).toBe(finalizedEarly.finalizedAt.toISOString());
    });

    it('quarantines any in-window event processed after finalization', () => {
      const finalized = { ...contest, status: ContestStatus.FINALIZED, finalizedAt: end };
      expect(
        classifyContestEvent(finalized, { eventTime: new Date(end.getTime() - 1000), ingestedAt: start }),
      ).toBe(ContestEventDisposition.PENDING_CORRECTION);
    });
  });

  describe('late delivery', () => {
    it('does not mutate published scores', async () => {
      await ingest('e1', new Date('2026-11-02T00:00:00Z'), new Date('2026-11-02T00:00:01Z'), 10);
      await service.publishResults('c1', new Date(end.getTime() + minutes(10)));
      expect(contestRow().publishedScores).toEqual({ p1: 10 });

      const late = await ingest('e2', new Date(end.getTime() - 1000), new Date(end.getTime() + minutes(30)), 500);
      expect(late.disposition).toBe(ContestEventDisposition.PENDING_CORRECTION);

      const published = await service.getPublishedResults('c1');
      expect(published).toMatchObject({ revision: 1, scores: { p1: 10 } });
      expect(await service.listPendingCorrections('c1')).toHaveLength(1);
    });

    it('excludes events whose event time is after the contest end', async () => {
      const r = await ingest('e3', new Date(end.getTime() + 1), new Date(end.getTime() + 2));
      expect(r.disposition).toBe(ContestEventDisposition.EXCLUDED_OUT_OF_WINDOW);
      expect(await service.computeAcceptedScores('c1')).toEqual({});
    });

    it('quarantines late events that arrive before the finalization job runs', async () => {
      const r = await ingest('e4', new Date(end.getTime() - 1000), new Date(end.getTime() + minutes(6)), 7);
      expect(r.disposition).toBe(ContestEventDisposition.PENDING_CORRECTION);
      await service.publishResults('c1', new Date(end.getTime() + minutes(7)));
      expect(contestRow().publishedScores).toEqual({});
    });
  });

  describe('duplicate replay', () => {
    it('is idempotent before and after finalization', async () => {
      const t = new Date('2026-11-03T00:00:00Z');
      const first = await ingest('e1', t, t, 10);
      const replay = await ingest('e1', t, new Date(end.getTime() + minutes(60)), 10);
      expect(first.duplicate).toBe(false);
      expect(replay.duplicate).toBe(true);
      expect(replay.disposition).toBe(ContestEventDisposition.ACCEPTED);

      await service.publishResults('c1', new Date(end.getTime() + minutes(10)));
      const postFinalReplay = await ingest('e1', t, new Date(end.getTime() + minutes(90)), 10);
      expect(postFinalReplay.duplicate).toBe(true);
      expect(events.rows).toHaveLength(1);
      expect(contestRow().publishedScores).toEqual({ p1: 10 });
    });

    it('treats a lost unique-key race as a duplicate', async () => {
      const t = new Date('2026-11-03T00:00:00Z');
      await ingest('e1', t, t, 10);
      events.findOne.mockResolvedValueOnce(null); // simulate race: pre-check misses
      const r = await ingest('e1', t, t, 10);
      expect(r.duplicate).toBe(true);
    });

    it('cannot publish twice', async () => {
      await service.publishResults('c1', new Date(end.getTime() + minutes(10)));
      await expect(service.publishResults('c1', new Date(end.getTime() + minutes(20)))).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('authorized correction', () => {
    beforeEach(async () => {
      await ingest('e1', new Date('2026-11-02T00:00:00Z'), new Date('2026-11-02T00:00:00Z'), 10, 'p1');
      await service.publishResults('c1', new Date(end.getTime() + minutes(10)));
      await ingest('late-1', new Date(end.getTime() - 1000), new Date(end.getTime() + minutes(30)), 25, 'p2');
    });

    it('applies quarantined events, bumps the revision and records an audit', async () => {
      const correction = await service.applyCorrection('c1', ['late-1'], admin, 'Delayed Horizon stream', 1);
      expect(correction).toMatchObject({
        fromRevision: 1,
        toRevision: 2,
        actorId: 'admin-1',
        previousScores: { p1: 10 },
        newScores: { p1: 10, p2: 25 },
      });
      expect(await service.getPublishedResults('c1')).toMatchObject({
        revision: 2,
        scores: { p1: 10, p2: 25 },
      });
      expect(events.rows.find((e) => e.eventId === 'late-1')).toMatchObject({
        disposition: ContestEventDisposition.CORRECTION_APPLIED,
        correctionId: correction.id,
      });
      expect(await service.listPendingCorrections('c1')).toHaveLength(0);
    });

    it('rejects unauthorized actors', async () => {
      await expect(
        service.applyCorrection('c1', ['late-1'], { id: 'u1', roles: ['trader'] }, 'please'),
      ).rejects.toThrow(ForbiddenException);
      expect(contestRow().resultRevision).toBe(1);
    });

    it('rejects re-applying an event and stale revisions', async () => {
      await service.applyCorrection('c1', ['late-1'], admin, 'first');
      await expect(service.applyCorrection('c1', ['late-1'], admin, 'again')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.applyCorrection('c1', ['late-1'], admin, 'stale', 1)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not allow accepted or excluded events to be applied', async () => {
      await expect(service.applyCorrection('c1', ['e1'], admin, 'double count')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('requires a reason', async () => {
      await expect(service.applyCorrection('c1', ['late-1'], admin, '  ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
