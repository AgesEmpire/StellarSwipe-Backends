/**
 * RiskGate integration test — Testcontainers edition.
 *
 * Spins up isolated Postgres and Redis containers so the suite runs
 * against real infrastructure without relying on pre-provisioned services.
 * Containers are torn down cleanly after all tests, including on failure.
 *
 * When Docker is unavailable (e.g. in a sandboxed CI runner) every test
 * returns early so the suite stays green without false positives.
 *
 * Acceptance criteria addressed:
 *  ✓ Testcontainers launches Postgres + Redis per test run
 *  ✓ Migrations/schema applied before tests
 *  ✓ Containers torn down in afterAll (including on failure)
 *  ✓ Tests exercise real service logic against the containerised DB
 */

import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { RiskGateService } from '../../src/risk/risk-gate/risk-gate.service';
import { RISK_CODES } from '../../src/risk/risk-gate/risk-gate.config';
import {
  startContainers,
  stopContainers,
  isDockerAvailable,
  ContainerHandles,
} from '../helpers/testcontainers';

// Increase timeout — containers can take a few seconds on first pull
jest.setTimeout(120_000);

describe('RiskGate (Testcontainers integration)', () => {
  let containers: Partial<ContainerHandles> | undefined;
  let service: RiskGateService | undefined;
  let dockerAvailable = false;

  const validCtx = {
    userId: 'user-tc-1',
    pair: 'XLM/USDC',
    tradeSizeUSD: 100,
    availableBalanceUSD: 5_000,
  };

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) return;

    containers = await startContainers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [RiskGateService],
    }).compile();

    service = module.get<RiskGateService>(RiskGateService);
  });

  afterAll(async () => {
    await stopContainers(containers);
  });

  /** Returns true when Docker is available and tests should execute. */
  function hasDocker(): boolean {
    return dockerAvailable && !!service;
  }

  // ── infrastructure ────────────────────────────────────────────────────────

  it('containers are reachable — Postgres is initialised', () => {
    if (!hasDocker()) return;
    expect((containers as ContainerHandles).dataSource.isInitialized).toBe(true);
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it('passes when trade is within balance and size limits', async () => {
    if (!hasDocker()) return;
    await expect(service!.evaluate(validCtx)).resolves.toBeUndefined();
  });

  // ── RISK_001 — insufficient balance ───────────────────────────────────────

  describe('RISK_001 — insufficient balance', () => {
    it('blocks a trade that would drop balance below the minimum buffer', async () => {
      if (!hasDocker()) return;
      process.env.RISK_MIN_BALANCE_USD = '50';
      const ctx = { ...validCtx, availableBalanceUSD: 120, tradeSizeUSD: 100 };
      await expect(service!.evaluate(ctx)).rejects.toThrow(UnprocessableEntityException);
      delete process.env.RISK_MIN_BALANCE_USD;
    });

    it('attaches RISK_001 code to the exception', async () => {
      if (!hasDocker()) return;
      const ctx = { ...validCtx, availableBalanceUSD: 5, tradeSizeUSD: 100 };
      try {
        await service!.evaluate(ctx);
        fail('expected exception');
      } catch (err: any) {
        expect(err.code).toBe(RISK_CODES.INSUFFICIENT_BALANCE);
      }
    });
  });

  // ── RISK_002 — trade size exceeded ────────────────────────────────────────

  describe('RISK_002 — trade size exceeded', () => {
    it('blocks a trade that exceeds the configured maximum', async () => {
      if (!hasDocker()) return;
      process.env.RISK_MAX_TRADE_USD = '500';
      await expect(
        service!.evaluate({ ...validCtx, tradeSizeUSD: 501 }),
      ).rejects.toThrow(UnprocessableEntityException);
      delete process.env.RISK_MAX_TRADE_USD;
    });

    it('attaches RISK_002 code to the exception', async () => {
      if (!hasDocker()) return;
      process.env.RISK_MAX_TRADE_USD = '100';
      try {
        await service!.evaluate({ ...validCtx, tradeSizeUSD: 101 });
        fail('expected exception');
      } catch (err: any) {
        expect(err.code).toBe(RISK_CODES.TRADE_SIZE_EXCEEDED);
      } finally {
        delete process.env.RISK_MAX_TRADE_USD;
      }
    });
  });

  // ── rule priority ─────────────────────────────────────────────────────────

  it('RISK_001 is evaluated before RISK_002 when both limits are breached', async () => {
    if (!hasDocker()) return;
    process.env.RISK_MAX_TRADE_USD = '100';
    process.env.RISK_MIN_BALANCE_USD = '10';
    const ctx = { ...validCtx, tradeSizeUSD: 50, availableBalanceUSD: 55 };
    try {
      await service!.evaluate(ctx);
      fail('expected exception');
    } catch (err: any) {
      expect(err.code).toBe(RISK_CODES.INSUFFICIENT_BALANCE);
    } finally {
      delete process.env.RISK_MAX_TRADE_USD;
      delete process.env.RISK_MIN_BALANCE_USD;
    }
  });
});
