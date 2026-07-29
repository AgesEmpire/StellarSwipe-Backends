import { ConfigService } from '@nestjs/config';
import { Registry } from 'prom-client';
import { TradeLatencyService, TradeStage } from './trade-latency.service';
import { PrometheusService } from '../../monitoring/metrics/prometheus.service';

function buildService(slowThresholdMs = 5_000): {
  svc: TradeLatencyService;
  registry: Registry;
} {
  const registry = new Registry();
  const prometheus = { registry } as unknown as PrometheusService;
  const config = {
    get: (_key: string, def: unknown) => def,
  } as unknown as ConfigService;

  const svc = new TradeLatencyService(prometheus, config);
  svc.onModuleInit();
  return { svc, registry };
}

describe('TradeLatencyService', () => {
  describe('startFlow / endFlow', () => {
    it('returns a snapshot with a positive totalMs', async () => {
      const { svc } = buildService();
      svc.startFlow('trade-1');
      await new Promise((r) => setTimeout(r, 5));
      const snap = svc.endFlow('trade-1', 'success');
      expect(snap.tradeId).toBe('trade-1');
      expect(snap.totalMs).toBeGreaterThan(0);
      expect(snap.slow).toBe(false);
    });

    it('marks flow as slow when totalMs exceeds threshold', async () => {
      const { svc } = buildService(1); // 1 ms threshold
      svc.startFlow('trade-slow');
      await new Promise((r) => setTimeout(r, 10));
      const snap = svc.endFlow('trade-slow', 'success');
      expect(snap.slow).toBe(true);
    });

    it('decrements active flows gauge on endFlow', async () => {
      const { svc, registry } = buildService();
      svc.startFlow('t1');
      svc.startFlow('t2');

      let metrics = await registry.metrics();
      expect(metrics).toMatch(/trade_active_flows\s+2/);

      svc.endFlow('t1');
      metrics = await registry.metrics();
      expect(metrics).toMatch(/trade_active_flows\s+1/);
    });

    it('is safe to call endFlow without a prior startFlow', () => {
      const { svc } = buildService();
      expect(() => svc.endFlow('ghost-trade')).not.toThrow();
    });
  });

  describe('startStage / endStage', () => {
    it('records stage duration in Prometheus histogram', async () => {
      const { svc, registry } = buildService();
      svc.startFlow('trade-2');
      svc.startStage('trade-2', TradeStage.VALIDATION);
      await new Promise((r) => setTimeout(r, 5));
      svc.endStage('trade-2', TradeStage.VALIDATION, 'success');

      const metrics = await registry.metrics();
      expect(metrics).toContain('trade_stage_duration_seconds');
      expect(metrics).toContain('stage="validation"');
    });

    it('records failure label when stage throws', async () => {
      const { svc, registry } = buildService();
      svc.startFlow('trade-3');
      svc.startStage('trade-3', TradeStage.EXECUTION);
      svc.endStage('trade-3', TradeStage.EXECUTION, 'failure');

      const metrics = await registry.metrics();
      expect(metrics).toContain('status="failure"');
    });

    it('is safe to call endStage without a prior startStage', () => {
      const { svc } = buildService();
      svc.startFlow('trade-4');
      expect(() => svc.endStage('trade-4', TradeStage.SETTLEMENT)).not.toThrow();
    });
  });

  describe('measureStage', () => {
    it('resolves and records success for passing fn', async () => {
      const { svc, registry } = buildService();
      svc.startFlow('trade-5');

      const result = await svc.measureStage('trade-5', TradeStage.CREATION, async () => 'created');
      expect(result).toBe('created');

      const metrics = await registry.metrics();
      expect(metrics).toContain('stage="creation"');
      expect(metrics).toContain('status="success"');
    });

    it('re-throws error and records failure label', async () => {
      const { svc, registry } = buildService();
      svc.startFlow('trade-6');

      await expect(
        svc.measureStage('trade-6', TradeStage.EXECUTION, async () => {
          throw new Error('stellar rpc error');
        }),
      ).rejects.toThrow('stellar rpc error');

      const metrics = await registry.metrics();
      expect(metrics).toContain('status="failure"');
    });
  });

  describe('end-to-end histogram', () => {
    it('records end-to-end duration metric', async () => {
      const { svc, registry } = buildService();
      svc.startFlow('trade-e2e');
      await new Promise((r) => setTimeout(r, 5));
      svc.endFlow('trade-e2e', 'success');

      const metrics = await registry.metrics();
      expect(metrics).toContain('trade_end_to_end_duration_seconds');
    });
  });

  describe('slow flow counter', () => {
    it('increments slow_flows_total when stage exceeds threshold', async () => {
      const { svc, registry } = buildService(1); // 1 ms threshold
      svc.startFlow('trade-slow-stage');
      svc.startStage('trade-slow-stage', TradeStage.VALIDATION);
      await new Promise((r) => setTimeout(r, 10));
      svc.endStage('trade-slow-stage', TradeStage.VALIDATION);

      const metrics = await registry.metrics();
      expect(metrics).toContain('trade_slow_flows_total');
    });
  });
});
