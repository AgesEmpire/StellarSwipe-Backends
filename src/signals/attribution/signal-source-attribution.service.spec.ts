import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AttributionSourceInput,
  SignalSourceAttributionService,
} from './signal-source-attribution.service';

const SIGNAL = '11111111-1111-1111-1111-111111111111';

function makeRepo() {
  const rows: any[] = [];
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: jest.fn((x: any) => ({ ...x })),
    count: jest.fn(async ({ where }: any) => rows.filter((r) => match(r, where)).length),
    save: jest.fn(async (list: any[]) => {
      const saved = list.map((x) => ({ ...x, id: `id-${rows.length + 1}`, recordedAt: new Date() }));
      rows.push(...saved);
      return saved;
    }),
    find: jest.fn(async ({ where }: any) =>
      rows
        .filter((r) => match(r, where))
        .map((r) => ({ ...r }))
        .sort((a, b) => Number(b.contributionWeight) - Number(a.contributionWeight)),
    ),
    findOne: jest.fn(async ({ where }: any) => {
      const list = rows.filter((r) => match(r, where)).sort((a, b) => b.signalVersion - a.signalVersion);
      return list[0] ? { ...list[0] } : null;
    }),
  };
}

const sources = (): AttributionSourceInput[] => [
  {
    sourceId: 'feed-alpha',
    sourceType: 'MARKET_FEED',
    contributionWeight: 0.5,
    publicLabel: 'Alpha Market Feed',
    isPublic: true,
    contributionMetadata: { score: 0.91, apiKeyRef: 'secret-ref' },
  },
  {
    sourceId: 'model-x',
    sourceType: 'ML_MODEL',
    contributionWeight: 0.3,
    publicLabel: 'Model X',
    isPublic: true,
  },
  {
    sourceId: 'partner-private',
    sourceType: 'PARTNER',
    contributionWeight: 0.2,
    isPublic: false,
    contributionMetadata: { contract: 'confidential' },
  },
];

describe('SignalSourceAttributionService (#1515)', () => {
  let repo: ReturnType<typeof makeRepo>;
  let svc: SignalSourceAttributionService;

  beforeEach(() => {
    repo = makeRepo();
    svc = new SignalSourceAttributionService(repo as any);
  });

  describe('aggregation', () => {
    it('stores every source with its contribution against the signal version', async () => {
      await svc.recordForVersion(SIGNAL, 1, sources());
      const rows = await svc.getForVersion(SIGNAL, 1);
      expect(rows.map((r) => [r.sourceId, r.contributionWeight])).toEqual([
        ['feed-alpha', '0.500000'],
        ['model-x', '0.300000'],
        ['partner-private', '0.200000'],
      ]);
      expect(rows.every((r) => r.signalVersion === 1)).toBe(true);
    });

    it('snapshots inputs so later provider-state mutation does not alter history', async () => {
      const input = sources();
      await svc.recordForVersion(SIGNAL, 1, input);
      (input[0].contributionMetadata as any).score = 0.1;
      input[0].publicLabel = 'Renamed';
      const [row] = await svc.getForVersion(SIGNAL, 1);
      expect(row.contributionMetadata).toEqual({ score: 0.91, apiKeyRef: 'secret-ref' });
      expect(row.publicLabel).toBe('Alpha Market Feed');
    });

    it('rejects weights that do not sum to 1, duplicates, and empty sets', async () => {
      const bad = sources();
      bad[0].contributionWeight = 0.9;
      await expect(svc.recordForVersion(SIGNAL, 1, bad)).rejects.toBeInstanceOf(BadRequestException);
      const dup = sources();
      dup[1].sourceId = 'feed-alpha';
      await expect(svc.recordForVersion(SIGNAL, 1, dup)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.recordForVersion(SIGNAL, 1, [])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('treats a recorded version as immutable', async () => {
      await svc.recordForVersion(SIGNAL, 1, sources());
      await expect(svc.recordForVersion(SIGNAL, 1, sources())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('public projection', () => {
    it('exposes only approved fields and aggregates undisclosed weight', async () => {
      await svc.recordForVersion(SIGNAL, 1, sources());
      const pub = await svc.getPublicAttribution(SIGNAL);
      expect(pub).toEqual({
        signalId: SIGNAL,
        signalVersion: 1,
        sources: [
          { sourceType: 'MARKET_FEED', label: 'Alpha Market Feed', contributionWeight: 0.5 },
          { sourceType: 'ML_MODEL', label: 'Model X', contributionWeight: 0.3 },
        ],
        undisclosedWeight: 0.2,
      });
      const json = JSON.stringify(pub);
      expect(json).not.toContain('feed-alpha');
      expect(json).not.toContain('secret-ref');
      expect(json).not.toContain('confidential');
    });
  });

  describe('correction', () => {
    it('records a restated set as a new version and keeps the prior version', async () => {
      await svc.recordForVersion(SIGNAL, 1, sources());
      await svc.recordCorrection(SIGNAL, 2, [
        { sourceId: 'feed-alpha', sourceType: 'MARKET_FEED', contributionWeight: 0.7, publicLabel: 'Alpha Market Feed', isPublic: true },
        { sourceId: 'model-x', sourceType: 'ML_MODEL', contributionWeight: 0.3, publicLabel: 'Model X', isPublic: true },
      ]);
      expect((await svc.getPublicAttribution(SIGNAL)).signalVersion).toBe(2);
      expect((await svc.getForVersion(SIGNAL, 1))).toHaveLength(3);
      expect((await svc.getForVersion(SIGNAL, 2))[0].contributionWeight).toBe('0.700000');
    });

    it('refuses corrections that do not advance the version', async () => {
      await svc.recordForVersion(SIGNAL, 2, sources());
      await expect(svc.recordCorrection(SIGNAL, 1, sources())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('requires an existing attribution to correct', async () => {
      await expect(svc.recordCorrection(SIGNAL, 2, sources())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('source removal', () => {
    it('drops the source in a new version, renormalising remaining weights to 1', async () => {
      await svc.recordForVersion(SIGNAL, 1, sources());
      const v2 = await svc.removeSource(SIGNAL, 2, 'model-x');
      const weights = v2.map((r) => Number(r.contributionWeight));
      expect(v2.map((r) => r.sourceId).sort()).toEqual(['feed-alpha', 'partner-private']);
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(Number(v2.find((r) => r.sourceId === 'feed-alpha')!.contributionWeight)).toBeCloseTo(
        0.5 / 0.7,
        6,
      );
      // History intact
      expect((await svc.getForVersion(SIGNAL, 1)).map((r) => r.sourceId)).toContain('model-x');
    });

    it('rejects removing an unknown or the only source', async () => {
      await svc.recordForVersion(SIGNAL, 1, [
        { sourceId: 'solo', sourceType: 'MARKET_FEED', contributionWeight: 1 },
      ]);
      await expect(svc.removeSource(SIGNAL, 2, 'missing')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.removeSource(SIGNAL, 2, 'solo')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
