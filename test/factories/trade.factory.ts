import { faker } from '@faker-js/faker';

export type TestTradeStatus =
  | 'pending'
  | 'confirmed'
  | 'settled'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type TestTradeSide = 'buy' | 'sell';

export interface TestTrade {
  id: string;
  userId: string;
  signalId: string;
  status: TestTradeStatus;
  side: TestTradeSide;
  baseAsset: string;
  counterAsset: string;
  amount: string;
  price: string;
  createdAt: Date;
  closedAt: Date | null;
}

export interface CreateTradeOptions {
  id?: string;
  userId?: string;
  signalId?: string;
  status?: TestTradeStatus;
  side?: TestTradeSide;
  baseAsset?: string;
  counterAsset?: string;
  amount?: string;
  price?: string;
}

/**
 * TradeFactory — generates deterministic test trade data.
 *
 * A trade always belongs to the user who executed it (`userId`) and the
 * signal it was copied from (`signalId`) — both are required, explicit
 * relationships rather than incidental random ids, mirroring the
 * `trades.user_id` / `trades.signal_id` foreign keys on the real entity.
 */
export class TradeFactory {
  build(overrides: CreateTradeOptions = {}): TestTrade {
    if (!overrides.userId) {
      throw new Error('TradeFactory.build requires an explicit userId — a trade always belongs to a user');
    }
    if (!overrides.signalId) {
      throw new Error('TradeFactory.build requires an explicit signalId — a trade always references the signal it copies');
    }

    return {
      id: overrides.id ?? faker.string.uuid(),
      userId: overrides.userId,
      signalId: overrides.signalId,
      status: overrides.status ?? 'pending',
      side: overrides.side ?? 'buy',
      baseAsset: overrides.baseAsset ?? 'XLM',
      counterAsset: overrides.counterAsset ?? 'USDC',
      amount: overrides.amount ?? faker.finance.amount({ min: 1, max: 10000, dec: 7 }),
      price: overrides.price ?? faker.finance.amount({ min: 0.01, max: 100, dec: 7 }),
      createdAt: new Date(),
      closedAt: null,
    };
  }

  buildMany(count: number, overrides: CreateTradeOptions): TestTrade[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  /** Build a trade that has already settled, with a close timestamp. */
  buildSettled(overrides: CreateTradeOptions): TestTrade {
    return { ...this.build({ ...overrides, status: 'settled' }), closedAt: new Date() };
  }
}
