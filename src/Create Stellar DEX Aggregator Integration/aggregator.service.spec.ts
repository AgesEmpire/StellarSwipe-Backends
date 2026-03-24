import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AggregatorService } from './aggregator.service';
import { LobstrDexAdapter } from './dexes/lobstr-dex.adapter';
import { StellarxDexAdapter } from './dexes/stellarx-dex.adapter';
import { StellarTermDexAdapter } from './dexes/stellarterm-dex.adapter';
import { QuoteAggregatorService } from './services/quote-aggregator.service';
import { RouteOptimizerService } from './services/route-optimizer.service';
import { DexRouteEntity } from './entities/dex-route.entity';
import { LiquidityPoolEntity } from './entities/liquidity-pool.entity';
import { DexQuote, StellarAsset, LiquidityPoolInfo } from './interfaces/dex-adapter.interface';
import { QuoteRequest, RouteRequest } from './interfaces/quote-request.interface';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const XLM: StellarAsset = { code: 'XLM', type: 'native' };
const USDC: StellarAsset = {
  code: 'USDC',
  issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  type: 'credit_alphanum4',
};

const makeQuote = (dexId: string, dexName: string, price: number, fee = 0.003): DexQuote => ({
  dexId,
  dexName,
  sourceAmount: '100.0000000',
  destinationAmount: (100 * price).toFixed(7),
  price,
  priceInverse: 1 / price,
  fee,
  feeAsset: XLM,
  path: [],
  estimatedSlippage: 0.1,
  confidence: 0.9,
  timestamp: new Date(),
  expiresAt: new Date(Date.now() + 30_000),
});

const LOBSTR_QUOTE = makeQuote('lobstr', 'Lobstr', 0.985);
const STELLARX_QUOTE = makeQuote('stellarx', 'StellarX', 0.99, 0.004);
const STELLARTERM_QUOTE = makeQuote('stellarterm', 'StellarTerm', 0.975);

const makePool = (dexId: string, tvl: number): LiquidityPoolInfo => ({
  poolId: `${dexId}-pool-1`,
  dexId,
  assets: [XLM, USDC],
  totalValueLocked: tvl,
  volume24h: tvl * 0.1,
  fee: 0.003,
  reserveA: '500000.0000000',
  reserveB: '50000.0000000',
});

const BASE_QUOTE_REQUEST: QuoteRequest = {
  sourceAsset: XLM,
  destinationAsset: USDC,
  sourceAmount: '100.0000000',
  slippageTolerance: 0.5,
};

// ─── Mock factories ───────────────────────────────────────────────────────────

const mockAdapter = (id: string, name: string, quote: DexQuote, healthy = true) => ({
  dexId: id,
  dexName: name,
  getQuote: jest.fn().mockResolvedValue(quote),
  getLiquidityPools: jest.fn().mockResolvedValue([makePool(id, 1_000_000)]),
  getOrderBook: jest.fn().mockResolvedValue({ dexId: id, bids: [], asks: [], spread: 0.1, midPrice: 0.985 }),
  isHealthy: jest.fn().mockResolvedValue(healthy),
});

const mockRouteRepo = () => ({
  create: jest.fn().mockImplementation((dto) => dto),
  save: jest.fn().mockResolvedValue({ id: 'uuid-1', ...{} }),
  find: jest.fn().mockResolvedValue([]),
  upsert: jest.fn().mockResolvedValue(undefined),
});

const mockPoolRepo = () => ({
  upsert: jest.fn().mockResolvedValue(undefined),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AggregatorService', () => {
  let service: AggregatorService;
  let lobstrAdapter: ReturnType<typeof mockAdapter>;
  let stellarxAdapter: ReturnType<typeof mockAdapter>;
  let stellartermAdapter: ReturnType<typeof mockAdapter>;
  let routeRepo: jest.Mocked<Partial<Repository<DexRouteEntity>>>;
  let poolRepo: jest.Mocked<Partial<Repository<LiquidityPoolEntity>>>;
  let quoteAggregatorService: QuoteAggregatorService;
  let routeOptimizerService: RouteOptimizerService;

  beforeEach(async () => {
    lobstrAdapter = mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE);
    stellarxAdapter = mockAdapter('stellarx', 'StellarX', STELLARX_QUOTE);
    stellartermAdapter = mockAdapter('stellarterm', 'StellarTerm', STELLARTERM_QUOTE);
    routeRepo = mockRouteRepo() as any;
    poolRepo = mockPoolRepo() as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AggregatorService,
        QuoteAggregatorService,
        RouteOptimizerService,
        { provide: LobstrDexAdapter, useValue: lobstrAdapter },
        { provide: StellarxDexAdapter, useValue: stellarxAdapter },
        { provide: StellarTermDexAdapter, useValue: stellartermAdapter },
        { provide: getRepositoryToken(DexRouteEntity), useValue: routeRepo },
        { provide: getRepositoryToken(LiquidityPoolEntity), useValue: poolRepo },
      ],
    }).compile();

    service = module.get<AggregatorService>(AggregatorService);
    quoteAggregatorService = module.get<QuoteAggregatorService>(QuoteAggregatorService);
    routeOptimizerService = module.get<RouteOptimizerService>(RouteOptimizerService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getAggregatedQuote ──────────────────────────────────────────────────────

  describe('getAggregatedQuote()', () => {
    it('should return aggregated quote with bestQuote from highest-scoring DEX', async () => {
      const result = await service.getAggregatedQuote(BASE_QUOTE_REQUEST);

      expect(result.allQuotes).toHaveLength(3);
      expect(result.dexesQueried).toBe(3);
      expect(result.dexesResponded).toBe(3);
      expect(result.bestQuote).toBeDefined();
      expect(result.bestQuote.dexId).toBe('stellarx'); // highest price 0.99
    });

    it('should still return result when one DEX fails', async () => {
      lobstrAdapter.getQuote.mockRejectedValue(new Error('Lobstr timeout'));

      const result = await service.getAggregatedQuote(BASE_QUOTE_REQUEST);

      expect(result.dexesResponded).toBe(2);
      expect(result.allQuotes).toHaveLength(2);
    });

    it('should throw when all DEXes fail', async () => {
      lobstrAdapter.getQuote.mockRejectedValue(new Error('offline'));
      stellarxAdapter.getQuote.mockRejectedValue(new Error('offline'));
      stellartermAdapter.getQuote.mockRejectedValue(new Error('offline'));

      await expect(service.getAggregatedQuote(BASE_QUOTE_REQUEST)).rejects.toThrow(
        'No quotes returned from any DEX',
      );
    });

    it('should persist the best route to the database', async () => {
      await service.getAggregatedQuote(BASE_QUOTE_REQUEST);

      expect(routeRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dexId: 'stellarx',
          sourceAssetCode: 'XLM',
          destinationAssetCode: 'USDC',
          isOptimal: true,
        }),
      );
      expect(routeRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should exclude DEXes listed in request.excludeDexes', async () => {
      const request: QuoteRequest = {
        ...BASE_QUOTE_REQUEST,
        excludeDexes: ['lobstr'],
      };

      const result = await service.getAggregatedQuote(request);

      expect(lobstrAdapter.getQuote).not.toHaveBeenCalled();
      expect(result.dexesQueried).toBe(2);
    });

    it('should include aggregationTimeMs in the response', async () => {
      const result = await service.getAggregatedQuote(BASE_QUOTE_REQUEST);
      expect(result.aggregationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should include a timestamp', async () => {
      const before = Date.now();
      const result = await service.getAggregatedQuote(BASE_QUOTE_REQUEST);
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  // ── compareDexes ───────────────────────────────────────────────────────────

  describe('compareDexes()', () => {
    it('should return ranked comparisons for all DEXes', async () => {
      const result = await service.compareDexes(BASE_QUOTE_REQUEST);

      expect(result.comparisons).toHaveLength(3);
      expect(result.bestDexId).toBe('stellarx');
      expect(result.comparisons[0].rank).toBe(1);
    });

    it('should compute a non-negative spreadPercent', async () => {
      const result = await service.compareDexes(BASE_QUOTE_REQUEST);
      expect(result.spreadPercent).toBeGreaterThanOrEqual(0);
    });

    it('should include isHealthy flag for each DEX', async () => {
      stellarxAdapter.isHealthy.mockResolvedValue(false);

      const result = await service.compareDexes(BASE_QUOTE_REQUEST);
      const stellarxEntry = result.comparisons.find((c) => c.dexId === 'stellarx');

      expect(stellarxEntry.isHealthy).toBe(false);
    });

    it('should throw when no quotes are available', async () => {
      lobstrAdapter.getQuote.mockRejectedValue(new Error());
      stellarxAdapter.getQuote.mockRejectedValue(new Error());
      stellartermAdapter.getQuote.mockRejectedValue(new Error());

      await expect(service.compareDexes(BASE_QUOTE_REQUEST)).rejects.toThrow(
        'No quotes available for comparison',
      );
    });

    it('each comparison should have a netPrice lower than price (after fee deduction)', async () => {
      const result = await service.compareDexes(BASE_QUOTE_REQUEST);
      result.comparisons.forEach((c) => {
        expect(c.netPrice).toBeLessThanOrEqual(c.price);
      });
    });
  });

  // ── findOptimalRoute ───────────────────────────────────────────────────────

  describe('findOptimalRoute()', () => {
    const routeRequest: RouteRequest = {
      ...BASE_QUOTE_REQUEST,
      optimizationStrategy: 'best_price',
      splitRouting: false,
    };

    it('should return a single optimal route', async () => {
      const result = await service.findOptimalRoute(routeRequest);

      expect(result.routeId).toBeDefined();
      expect(['single', 'split', 'multi-hop']).toContain(result.routeType);
      expect(result.expectedDestinationAmount).toBeDefined();
      expect(result.hops.length).toBeGreaterThan(0);
    });

    it('should return a split route when splitRouting is enabled', async () => {
      const splitRequest: RouteRequest = {
        ...routeRequest,
        splitRouting: true,
        maxSplits: 3,
      };

      const result = await service.findOptimalRoute(splitRequest);

      expect(result.routeType).toBe('split');
      expect(result.splits).toBeDefined();
      expect(result.splits.length).toBeGreaterThan(0);
    });

    it('should respect the lowest_fee strategy', async () => {
      const feeRequest: RouteRequest = {
        ...routeRequest,
        optimizationStrategy: 'lowest_fee',
      };

      const result = await service.findOptimalRoute(feeRequest);
      // Lobstr has the lowest fee (0.003), StellarX has 0.004
      expect(['lobstr', 'stellarterm']).toContain(result.hops[0].dexId);
    });

    it('should compute minimumDestinationAmount accounting for slippage', async () => {
      const result = await service.findOptimalRoute(routeRequest);
      const expected = parseFloat(result.expectedDestinationAmount) * 0.995; // 0.5% slippage
      expect(parseFloat(result.minimumDestinationAmount)).toBeCloseTo(expected, 3);
    });

    it('should include an expiresAt in the future', async () => {
      const result = await service.findOptimalRoute(routeRequest);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should throw when no routes are available', async () => {
      lobstrAdapter.getQuote.mockRejectedValue(new Error());
      stellarxAdapter.getQuote.mockRejectedValue(new Error());
      stellartermAdapter.getQuote.mockRejectedValue(new Error());

      await expect(service.findOptimalRoute(routeRequest)).rejects.toThrow(
        'No routes available from any DEX',
      );
    });
  });

  // ── getAggregatedLiquidity ─────────────────────────────────────────────────

  describe('getAggregatedLiquidity()', () => {
    it('should aggregate pools from all DEXes', async () => {
      const result = await service.getAggregatedLiquidity({
        baseAsset: XLM,
        counterAsset: USDC,
      });

      expect(result.pools).toHaveLength(3);
      expect(result.analysis).toBeDefined();
      expect(result.analysis.totalLiquidity).toBeGreaterThan(0);
    });

    it('should compute a dominantDex in the analysis', async () => {
      // Give StellarX more liquidity
      stellarxAdapter.getLiquidityPools.mockResolvedValue([
        makePool('stellarx', 5_000_000),
      ]);

      const result = await service.getAggregatedLiquidity({
        baseAsset: XLM,
        counterAsset: USDC,
      });

      expect(result.analysis.dominantDex).toBe('stellarx');
    });

    it('should sync pools to the database', async () => {
      await service.getAggregatedLiquidity({ baseAsset: XLM, counterAsset: USDC });
      expect(poolRepo.upsert).toHaveBeenCalledTimes(3);
    });

    it('should return empty pools when all adapters fail', async () => {
      lobstrAdapter.getLiquidityPools.mockRejectedValue(new Error());
      stellarxAdapter.getLiquidityPools.mockRejectedValue(new Error());
      stellartermAdapter.getLiquidityPools.mockRejectedValue(new Error());

      const result = await service.getAggregatedLiquidity({
        baseAsset: XLM,
        counterAsset: USDC,
      });

      expect(result.pools).toHaveLength(0);
      expect(result.analysis.totalLiquidity).toBe(0);
    });
  });

  // ── getDexHealthStatus ──────────────────────────────────────────────────────

  describe('getDexHealthStatus()', () => {
    it('should return health map for all adapters', async () => {
      const result = await service.getDexHealthStatus();

      expect(result).toEqual({
        lobstr: true,
        stellarx: true,
        stellarterm: true,
      });
    });

    it('should report unhealthy DEX correctly', async () => {
      lobstrAdapter.isHealthy.mockResolvedValue(false);

      const result = await service.getDexHealthStatus();

      expect(result.lobstr).toBe(false);
      expect(result.stellarx).toBe(true);
    });
  });

  // ── getRouteHistory ────────────────────────────────────────────────────────

  describe('getRouteHistory()', () => {
    it('should query the repository with correct filters', async () => {
      await service.getRouteHistory('XLM', 'USDC', 10);

      expect(routeRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sourceAssetCode: 'XLM', destinationAssetCode: 'USDC' },
          take: 10,
          order: { createdAt: 'DESC' },
        }),
      );
    });

    it('should return the records from the repository', async () => {
      const mockRoutes = [
        { id: 'r1', dexId: 'lobstr', price: 0.985 },
        { id: 'r2', dexId: 'stellarx', price: 0.99 },
      ];
      (routeRepo.find as jest.Mock).mockResolvedValue(mockRoutes);

      const result = await service.getRouteHistory('XLM', 'USDC');
      expect(result).toEqual(mockRoutes);
    });
  });
});

// ─── QuoteAggregatorService unit tests ────────────────────────────────────────

describe('QuoteAggregatorService', () => {
  let service: QuoteAggregatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuoteAggregatorService],
    }).compile();
    service = module.get<QuoteAggregatorService>(QuoteAggregatorService);
  });

  it('should aggregate quotes from multiple adapters', async () => {
    const adapters = [
      mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE),
      mockAdapter('stellarx', 'StellarX', STELLARX_QUOTE),
    ];

    const result = await service.aggregateQuotes(adapters, BASE_QUOTE_REQUEST);
    expect(result.quotes).toHaveLength(2);
    expect(result.failedDexes).toHaveLength(0);
  });

  it('should record failed DEXes without throwing', async () => {
    const adapters = [
      mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE),
      { ...mockAdapter('stellarx', 'StellarX', STELLARX_QUOTE), getQuote: jest.fn().mockRejectedValue(new Error('503')) },
    ];

    const result = await service.aggregateQuotes(adapters, BASE_QUOTE_REQUEST);
    expect(result.quotes).toHaveLength(1);
    expect(result.failedDexes).toHaveLength(1);
    expect(result.failedDexes[0].dexId).toBe('stellarx');
  });

  it('should respect the timeout and record timed-out DEX as failed', async () => {
    const slowAdapter = {
      ...mockAdapter('slow-dex', 'SlowDEX', LOBSTR_QUOTE),
      getQuote: jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000)),
      ),
    };

    const result = await service.aggregateQuotes(
      [mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE), slowAdapter],
      BASE_QUOTE_REQUEST,
      100, // 100ms timeout
    );

    expect(result.quotes).toHaveLength(1);
    expect(result.failedDexes[0].dexId).toBe('slow-dex');
  }, 10_000);

  it('should return health map from checkHealth()', async () => {
    const adapters = [
      mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE, true),
      mockAdapter('stellarx', 'StellarX', STELLARX_QUOTE, false),
    ];

    const health = await service.checkHealth(adapters);
    expect(health).toEqual({ lobstr: true, stellarx: false });
  });
});

// ─── RouteOptimizerService unit tests ────────────────────────────────────────

describe('RouteOptimizerService', () => {
  let service: RouteOptimizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RouteOptimizerService],
    }).compile();
    service = module.get<RouteOptimizerService>(RouteOptimizerService);
  });

  const routeRequest: RouteRequest = {
    sourceAsset: XLM,
    destinationAsset: USDC,
    sourceAmount: '100.0000000',
    optimizationStrategy: 'best_price',
    splitRouting: false,
  };

  it('should find optimal route from adapters', async () => {
    const adapters = [
      mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE),
      mockAdapter('stellarx', 'StellarX', STELLARX_QUOTE),
    ];

    const result = await service.findOptimalRoute(adapters, routeRequest);

    expect(result.routeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result.hops[0].dexId).toBe('stellarx'); // higher price
  });

  it('should pick lowest fee with lowest_fee strategy', async () => {
    const adapters = [
      mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE),           // fee 0.003
      mockAdapter('stellarx', 'StellarX', STELLARX_QUOTE),    // fee 0.004
    ];

    const result = await service.findOptimalRoute(adapters, {
      ...routeRequest,
      optimizationStrategy: 'lowest_fee',
    });

    expect(result.hops[0].dexId).toBe('lobstr');
  });

  it('should produce split route when splitRouting=true', async () => {
    const adapters = [
      mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE),
      mockAdapter('stellarx', 'StellarX', STELLARX_QUOTE),
      mockAdapter('stellarterm', 'StellarTerm', STELLARTERM_QUOTE),
    ];

    const result = await service.findOptimalRoute(adapters, {
      ...routeRequest,
      splitRouting: true,
      maxSplits: 3,
    });

    expect(result.routeType).toBe('split');
    expect(result.splits?.length).toBeGreaterThanOrEqual(1);
    const totalAllocation = result.splits.reduce(
      (sum, s) => sum + s.allocationPercent,
      0,
    );
    expect(totalAllocation).toBeCloseTo(100, 1);
  });

  it('should throw when no quotes are available', async () => {
    const adapters = [
      { ...mockAdapter('lobstr', 'Lobstr', LOBSTR_QUOTE), getQuote: jest.fn().mockRejectedValue(new Error()) },
    ];

    await expect(service.findOptimalRoute(adapters, routeRequest)).rejects.toThrow(
      'No routes available from any DEX',
    );
  });
});
