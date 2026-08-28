import { UserFactory } from './user.factory';
import { AuthFactory } from './auth.factory';
import { SessionFactory } from './session.factory';
import { PlatformFactory } from './platform.factory';

/**
 * Integration tests demonstrating factory usage.
 * These tests are order-independent and safe for parallel execution.
 */
describe('Test Factories', () => {
  const userFactory = new UserFactory();
  const authFactory = new AuthFactory();
  const sessionFactory = new SessionFactory();
  const platformFactory = new PlatformFactory();

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
});
