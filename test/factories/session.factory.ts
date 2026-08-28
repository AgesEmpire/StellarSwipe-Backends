import { faker } from '@faker-js/faker';

export interface TestSession {
  id: string;
  userId: string;
  type: 'buy' | 'sell' | 'swap';
  asset: string;
  amount: string;
  price: string;
  status: 'pending' | 'filled' | 'cancelled' | 'expired';
  stellarTxHash: string | null;
  createdAt: Date;
}

export interface CreateSessionOptions {
  userId?: string;
  type?: 'buy' | 'sell' | 'swap';
  asset?: string;
  amount?: string;
  price?: string;
  status?: 'pending' | 'filled' | 'cancelled' | 'expired';
}

/**
 * SessionFactory — generates test trade session data.
 */
export class SessionFactory {
  /**
   * Build a test session (does not persist).
   */
  build(overrides: CreateSessionOptions = {}): TestSession {
    return {
      id: faker.string.uuid(),
      userId: overrides.userId ?? faker.string.uuid(),
      type: overrides.type ?? faker.helpers.arrayElement(['buy', 'sell', 'swap']),
      asset: overrides.asset ?? faker.helpers.arrayElement(['XLM', 'USDC', 'BTC', 'ETH']),
      amount: overrides.amount ?? faker.finance.amount({ min: 1, max: 10000, dec: 7 }),
      price: overrides.price ?? faker.finance.amount({ min: 0.01, max: 100, dec: 7 }),
      status: overrides.status ?? 'pending',
      stellarTxHash: null,
      createdAt: new Date(),
    };
  }

  /**
   * Build multiple test sessions.
   */
  buildMany(count: number, overrides: CreateSessionOptions = {}): TestSession[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  /**
   * Build a completed session with a Stellar transaction hash.
   */
  buildFilled(overrides: CreateSessionOptions = {}): TestSession {
    return this.build({
      ...overrides,
      status: 'filled',
    });
  }
}
