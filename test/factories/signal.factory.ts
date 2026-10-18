import { faker } from '@faker-js/faker';

export type TestSignalType = 'BUY' | 'SELL';
export type TestSignalStatus = 'ACTIVE' | 'CLOSED' | 'EXPIRED' | 'CANCELLED';

export interface TestSignal {
  id: string;
  providerId: string;
  baseAsset: string;
  counterAsset: string;
  type: TestSignalType;
  status: TestSignalStatus;
  entryPrice: string;
  targetPrice: string;
  stopLossPrice: string;
  createdAt: Date;
}

export interface CreateSignalOptions {
  id?: string;
  providerId?: string;
  baseAsset?: string;
  counterAsset?: string;
  type?: TestSignalType;
  status?: TestSignalStatus;
  entryPrice?: string;
  targetPrice?: string;
  stopLossPrice?: string;
}

/**
 * SignalFactory — generates deterministic test signal data.
 *
 * Signals belong to a provider (`providerId` references `users.id`), so
 * integration tests that need a signal tied to a specific provider pass
 * `providerId` explicitly rather than relying on an unrelated random id —
 * see {@link EntityGraphFactory} for building a fully-linked scenario in
 * one call.
 */
export class SignalFactory {
  build(overrides: CreateSignalOptions = {}): TestSignal {
    const entryPrice = overrides.entryPrice ?? faker.finance.amount({ min: 0.01, max: 100, dec: 7 });

    return {
      id: overrides.id ?? faker.string.uuid(),
      providerId: overrides.providerId ?? faker.string.uuid(),
      baseAsset: overrides.baseAsset ?? 'XLM',
      counterAsset: overrides.counterAsset ?? 'USDC',
      type: overrides.type ?? 'BUY',
      status: overrides.status ?? 'ACTIVE',
      entryPrice,
      targetPrice: overrides.targetPrice ?? faker.finance.amount({ min: Number(entryPrice), max: 200, dec: 7 }),
      stopLossPrice: overrides.stopLossPrice ?? faker.finance.amount({ min: 0.01, max: Number(entryPrice), dec: 7 }),
      createdAt: new Date(),
    };
  }

  buildMany(count: number, overrides: CreateSignalOptions = {}): TestSignal[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  /** Build a signal that has already closed, for exercising historical-read paths. */
  buildClosed(overrides: CreateSignalOptions = {}): TestSignal {
    return this.build({ ...overrides, status: 'CLOSED' });
  }
}
