import { UserFactory, type TestUser, type CreateUserOptions } from './user.factory';
import { SignalFactory, type TestSignal, type CreateSignalOptions } from './signal.factory';
import { TradeFactory, type TestTrade, type CreateTradeOptions } from './trade.factory';

export interface SignalCopyTradeScenario {
  provider: TestUser;
  trader: TestUser;
  signal: TestSignal;
  trade: TestTrade;
}

export interface BuildSignalCopyTradeOptions {
  provider?: CreateUserOptions;
  trader?: CreateUserOptions;
  signal?: Omit<CreateSignalOptions, 'providerId'>;
  trade?: Omit<CreateTradeOptions, 'userId' | 'signalId'>;
}

/**
 * EntityGraphFactory — Issue #1370: deterministic builders for database
 * integration tests whose records span multiple related entities.
 *
 * Each individual factory (`UserFactory`, `SignalFactory`, `TradeFactory`)
 * produces one isolated, valid record with stable defaults. This factory
 * composes them into the relationship shapes integration tests actually
 * need — e.g. "a trader copied a provider's signal" — so every id
 * reference between records is correct and explicit by construction,
 * instead of tests hand-wiring foreign keys (and getting them wrong, or
 * drifting from the real schema) every time.
 *
 * Overrides at every level remain predictable: an override passed for the
 * provider, trader, signal or trade always wins over the generated
 * default, and relationship ids (`providerId`, `userId`, `signalId`) are
 * never overridable here — they are derived from the other built records
 * so the graph can never end up inconsistent.
 */
export class EntityGraphFactory {
  private readonly userFactory = new UserFactory();
  private readonly signalFactory = new SignalFactory();
  private readonly tradeFactory = new TradeFactory();

  /**
   * Builds a provider, a trader, a signal authored by the provider, and a
   * trade the trader executed by copying that signal — the most common
   * relational shape exercised by signal/trade integration suites.
   */
  buildSignalCopyTrade(options: BuildSignalCopyTradeOptions = {}): SignalCopyTradeScenario {
    const provider = this.userFactory.build(options.provider);
    const trader = this.userFactory.build(options.trader);

    const signal = this.signalFactory.build({
      ...options.signal,
      providerId: provider.id,
    });

    const trade = this.tradeFactory.build({
      ...options.trade,
      userId: trader.id,
      signalId: signal.id,
    });

    return { provider, trader, signal, trade };
  }

  /**
   * Builds one provider and `count` independent copy-trade scenarios for
   * that same provider's signals — useful for leaderboard/performance
   * integration tests that need many trades against one provider.
   */
  buildManyTradesForProvider(
    count: number,
    options: BuildSignalCopyTradeOptions = {},
  ): { provider: TestUser; scenarios: Omit<SignalCopyTradeScenario, 'provider'>[] } {
    const provider = this.userFactory.build(options.provider);

    const scenarios = Array.from({ length: count }, () => {
      const trader = this.userFactory.build(options.trader);
      const signal = this.signalFactory.build({ ...options.signal, providerId: provider.id });
      const trade = this.tradeFactory.build({
        ...options.trade,
        userId: trader.id,
        signalId: signal.id,
      });
      return { trader, signal, trade };
    });

    return { provider, scenarios };
  }
}
