import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RouteOptimizerService } from './route-optimizer.service';
import { SwapRouteRequestDto } from './dto/swap-route-request.dto';

const XLM = 'native';
const USDC = 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BTC = 'BTC:GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF';
const ETH = 'ETH:GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR';

describe('RouteOptimizerService', () => {
  let service: RouteOptimizerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RouteOptimizerService],
    }).compile();

    service = module.get(RouteOptimizerService);
  });

  describe('optimizeRoute', () => {
    it('returns a direct route for a well-known pair (XLM → USDC)', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: USDC,
        amount: 100,
      };

      const result = await service.optimizeRoute(request);

      expect(result.sourceAsset).toBe(XLM);
      expect(result.destinationAsset).toBe(USDC);
      expect(result.amount).toBe(100);
      expect(result.routeCount).toBeGreaterThan(0);
      expect(result.bestRoute).not.toBeNull();
      expect(result.bestRoute!.hops[0]).toBe(XLM);
      expect(result.bestRoute!.hops[result.bestRoute!.hops.length - 1]).toBe(USDC);
      expect(result.computedAt).toBeDefined();
    });

    it('best route has lower or equal cost than alternatives', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: BTC,
        amount: 1000,
        maxHops: 3,
      };

      const result = await service.optimizeRoute(request);

      if (result.bestRoute && result.alternativeRoutes.length > 0) {
        for (const alt of result.alternativeRoutes) {
          expect(result.bestRoute.totalCost).toBeLessThanOrEqual(alt.totalCost);
        }
      }
    });

    it('respects maxHops constraint', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: BTC,
        amount: 500,
        maxHops: 1,
      };

      const result = await service.optimizeRoute(request);

      if (result.bestRoute) {
        expect(result.bestRoute.hopCount).toBeLessThanOrEqual(1);
      }
      for (const route of result.alternativeRoutes) {
        expect(route.hopCount).toBeLessThanOrEqual(1);
      }
    });

    it('respects minLiquidity constraint — excludes low-liquidity routes', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: USDC,
        amount: 100,
        minLiquidity: 1_000_000, // very high — should exclude most routes
      };

      const result = await service.optimizeRoute(request);

      // All returned routes must have sufficient liquidity at every hop
      for (const route of [result.bestRoute, ...result.alternativeRoutes]) {
        if (!route) continue;
        for (const hop of route.hopDetails) {
          expect(hop.liquidity).toBeGreaterThanOrEqual(1_000_000);
        }
      }
    });

    it('throws BadRequestException when source equals destination', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: XLM,
        amount: 100,
      };

      await expect(service.optimizeRoute(request)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for zero amount', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: USDC,
        amount: 0,
      };

      await expect(service.optimizeRoute(request)).rejects.toThrow(BadRequestException);
    });

    it('returns empty response when no route exists', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: 'UNKNOWN:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        destinationAsset: 'ALSO_UNKNOWN:GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: 100,
      };

      const result = await service.optimizeRoute(request);

      expect(result.bestRoute).toBeNull();
      expect(result.routeCount).toBe(0);
      expect(result.alternativeRoutes).toHaveLength(0);
    });

    it('filters routes by allowedIntermediaryAssets', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: BTC,
        amount: 100,
        allowedIntermediaryAssets: [USDC],
        maxHops: 3,
      };

      const result = await service.optimizeRoute(request);

      // Any multi-hop route must only use USDC as intermediary
      for (const route of [result.bestRoute, ...result.alternativeRoutes]) {
        if (!route || route.hopCount <= 1) continue;
        const intermediaries = route.hops.slice(1, -1);
        for (const intermediary of intermediaries) {
          expect([USDC]).toContain(intermediary);
        }
      }
    });

    it('route response includes expected output and fee breakdown', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: USDC,
        amount: 1000,
      };

      const result = await service.optimizeRoute(request);

      expect(result.bestRoute).not.toBeNull();
      expect(result.bestRoute!.expectedOutput).toBeGreaterThan(0);
      expect(result.bestRoute!.totalFeeRate).toBeGreaterThanOrEqual(0);
      expect(result.bestRoute!.totalPriceImpact).toBeGreaterThanOrEqual(0);
      expect(result.bestRoute!.hopDetails).toHaveLength(result.bestRoute!.hopCount);
    });

    it('multi-hop route XLM → ETH via USDC is found when maxHops allows', async () => {
      const request: SwapRouteRequestDto = {
        sourceAsset: XLM,
        destinationAsset: ETH,
        amount: 500,
        maxHops: 3,
      };

      const result = await service.optimizeRoute(request);

      expect(result.routeCount).toBeGreaterThan(0);
      expect(result.bestRoute).not.toBeNull();
    });
  });
});
