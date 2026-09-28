import { ConfigService } from '@nestjs/config';
import { SettlementLatencyService } from './settlement-latency.service';

describe('SettlementLatencyService', () => {
  let service: SettlementLatencyService;

  beforeEach(() => {
    service = new SettlementLatencyService({
      get: jest.fn().mockReturnValue(1000),
    } as unknown as ConfigService);
  });

  it('creates latency metrics from execution and settlement timestamps', () => {
    service.recordTradeExecution('trade-1', new Date('2026-05-29T10:00:00.000Z'), 'XLM/USDC');

    const metric = service.recordSettlementCompletion(
      'trade-1',
      new Date('2026-05-29T10:00:00.750Z'),
    );

    expect(metric).toMatchObject({
      tradeId: 'trade-1',
      latencyMs: 750,
      assetPair: 'XLM/USDC',
    });
    expect(service.getMetrics()).toHaveLength(1);
  });

  it('aggregates average, p95, and p99 latency', () => {
    for (let i = 1; i <= 100; i++) {
      service.recordTradeExecution(`trade-${i}`, new Date(0));
      service.recordSettlementCompletion(`trade-${i}`, new Date(i * 10));
    }

    const summary = service.getSummary();

    expect(summary.count).toBe(100);
    expect(summary.averageMs).toBe(505);
    expect(summary.p95Ms).toBe(950);
    expect(summary.p99Ms).toBe(990);
  });

  it('generates alerts when latency exceeds the configured threshold', () => {
    service.recordTradeExecution('trade-slow', new Date('2026-05-29T10:00:00.000Z'));
    service.recordSettlementCompletion('trade-slow', new Date('2026-05-29T10:00:02.000Z'));

    expect(service.getAlerts()).toEqual([
      expect.objectContaining({
        tradeId: 'trade-slow',
        latencyMs: 2000,
        thresholdMs: 1000,
      }),
    ]);
  });

  it('does not alert when latency is within threshold', () => {
    service.recordTradeExecution('trade-fast', new Date('2026-05-29T10:00:00.000Z'));
    service.recordSettlementCompletion('trade-fast', new Date('2026-05-29T10:00:00.500Z'));

    expect(service.getAlerts()).toHaveLength(0);
  });
});
