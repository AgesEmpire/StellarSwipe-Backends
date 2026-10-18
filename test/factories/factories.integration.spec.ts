import { UserFactory } from './user.factory';
import { AuthFactory } from './auth.factory';
import { SessionFactory } from './session.factory';
import { PlatformFactory } from './platform.factory';
import { SignalFactory } from './signal.factory';
import { TradeFactory } from './trade.factory';
import { EntityGraphFactory } from './entity-graph.factory';

/**
 * Integration tests demonstrating factory usage.
 * These tests are order-independent and safe for parallel execution.
 */
describe('Test Factories', () => {
  const userFactory = new UserFactory();
  const authFactory = new AuthFactory();
  const sessionFactory = new SessionFactory();
  const platformFactory = new PlatformFactory();
  const signalFactory = new SignalFactory();
  const tradeFactory = new TradeFactory();
  const entityGraphFactory = new EntityGraphFactory();

  describe('UserFactory', () => {
    it('should create users with unique data', () => {
      const user1 = userFactory.build();
      const user2 = userFactory.build();

      expect(user1.id).not.toBe(user2.id);
      expect(user1.email).not.toBe(user2.email);
      expect(user1.username).not.toBe(user2.username);
      expect(user1.isVerified).toBe(true);
    });

    it('should accept overrides', () => {
      const user = userFactory.build({
        email: 'test@example.com',
        isVerified: false,
      });

      expect(user.email).toBe('test@example.com');
      expect(user.isVerified).toBe(false);
    });

    it('should build multiple users', () => {
      const users = userFactory.buildMany(5);

      expect(users).toHaveLength(5);
      const ids = new Set(users.map((u) => u.id));
      expect(ids.size).toBe(5);
    });
  });

  describe('AuthFactory', () => {
    it('should create valid JWT tokens for a user', () => {
      const user = userFactory.build();
      const authenticated = authFactory.authenticate(user);

      expect(authenticated.accessToken).toBeTruthy();
      expect(authenticated.refreshToken).toBeTruthy();
      expect(authenticated.user.id).toBe(user.id);
    });

    it('should produce a bearer header string', () => {
      const user = userFactory.build();
      const header = authFactory.bearerHeader(user);

      expect(header).toMatch(/^Bearer .+/);
    });
  });

  describe('SessionFactory', () => {
    it('should create sessions with deterministic defaults', () => {
      const session = sessionFactory.build({ userId: 'user-123', type: 'buy' });

      expect(session.userId).toBe('user-123');
      expect(session.type).toBe('buy');
      expect(session.status).toBe('pending');
      expect(session.stellarTxHash).toBeNull();
    });

    it('should build filled sessions', () => {
      const session = sessionFactory.buildFilled({ asset: 'XLM' });

      expect(session.status).toBe('filled');
      expect(session.asset).toBe('XLM');
    });

    it('should build multiple sessions independently', () => {
      const sessions = sessionFactory.buildMany(3, { type: 'sell' });

      expect(sessions).toHaveLength(3);
      sessions.forEach((s) => expect(s.type).toBe('sell'));
      const ids = new Set(sessions.map((s) => s.id));
      expect(ids.size).toBe(3);
    });
  });

  describe('PlatformFactory', () => {
    it('should create platform state with defaults', () => {
      const state = platformFactory.buildPlatformState();

      expect(state.platformFeeBps).toBe(250);
      expect(state.sessionCounter).toBe(0);
      expect(state.maxSessionDurationSeconds).toBe(604800);
    });

    it('should create signal providers', () => {
      const provider = platformFactory.buildSignalProvider({ winRate: 0.75 });

      expect(provider.winRate).toBe(0.75);
      expect(provider.isActive).toBe(true);
    });
  });

  // ── Issue #1370: deterministic builders with explicit relationships ──────

  describe('SignalFactory', () => {
    it('should create signals with stable defaults and a unique id per call', () => {
      const signal1 = signalFactory.build({ providerId: 'provider-123' });
      const signal2 = signalFactory.build({ providerId: 'provider-123' });

      expect(signal1.providerId).toBe('provider-123');
      expect(signal1.status).toBe('ACTIVE');
      expect(signal1.id).not.toBe(signal2.id);
    });

    it('should accept predictable overrides', () => {
      const signal = signalFactory.build({
        providerId: 'provider-123',
        baseAsset: 'BTC',
        type: 'SELL',
      });

      expect(signal.baseAsset).toBe('BTC');
      expect(signal.type).toBe('SELL');
    });

    it('buildClosed should produce a CLOSED signal', () => {
      const signal = signalFactory.buildClosed({ providerId: 'provider-123' });
      expect(signal.status).toBe('CLOSED');
    });
  });

  describe('TradeFactory', () => {
    it('should require an explicit userId and signalId (no incidental relationships)', () => {
      expect(() => tradeFactory.build({} as any)).toThrow(/userId/);
      expect(() => tradeFactory.build({ userId: 'user-1' } as any)).toThrow(/signalId/);
    });

    it('should build a valid, isolated trade linked to the given user and signal', () => {
      const trade = tradeFactory.build({ userId: 'user-1', signalId: 'signal-1' });

      expect(trade.userId).toBe('user-1');
      expect(trade.signalId).toBe('signal-1');
      expect(trade.status).toBe('pending');
    });

    it('buildSettled should produce a settled trade with a close timestamp', () => {
      const trade = tradeFactory.buildSettled({ userId: 'user-1', signalId: 'signal-1' });

      expect(trade.status).toBe('settled');
      expect(trade.closedAt).toBeInstanceOf(Date);
    });
  });

  describe('EntityGraphFactory', () => {
    it('should build a provider, trader, signal and trade with correct explicit relationships', () => {
      const scenario = entityGraphFactory.buildSignalCopyTrade();

      expect(scenario.signal.providerId).toBe(scenario.provider.id);
      expect(scenario.trade.userId).toBe(scenario.trader.id);
      expect(scenario.trade.signalId).toBe(scenario.signal.id);
      // Provider and trader are distinct records, not accidentally aliased.
      expect(scenario.provider.id).not.toBe(scenario.trader.id);
    });

    it('should honor overrides at every level while keeping relationship ids consistent', () => {
      const scenario = entityGraphFactory.buildSignalCopyTrade({
        provider: { username: 'provider_override' },
        signal: { baseAsset: 'BTC' },
        trade: { status: 'settled' },
      });

      expect(scenario.provider.username).toBe('provider_override');
      expect(scenario.signal.baseAsset).toBe('BTC');
      expect(scenario.trade.status).toBe('settled');
      expect(scenario.signal.providerId).toBe(scenario.provider.id);
      expect(scenario.trade.signalId).toBe(scenario.signal.id);
    });

    it('buildManyTradesForProvider should link every trade back to the same provider via its signal', () => {
      const { provider, scenarios } = entityGraphFactory.buildManyTradesForProvider(5);

      expect(scenarios).toHaveLength(5);
      const traderIds = new Set(scenarios.map((s) => s.trader.id));
      expect(traderIds.size).toBe(5); // each trader is isolated

      for (const { signal, trade } of scenarios) {
        expect(signal.providerId).toBe(provider.id);
        expect(trade.signalId).toBe(signal.id);
      }
    });
  });
});
