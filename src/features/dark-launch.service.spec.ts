import { DarkLaunchService } from './dark-launch.service';

describe('DarkLaunchService', () => {
  let service: DarkLaunchService;

  beforeEach(() => {
    service = new DarkLaunchService();
  });

  // ── register / update / remove ──────────────────────────────────────

  it('registers a config and retrieves it', () => {
    service.register({ feature: 'feat-a', rolloutPercentage: 50 });
    expect(service.getConfig('feat-a')?.rolloutPercentage).toBe(50);
  });

  it('updates an existing config', () => {
    service.register({ feature: 'feat-b', rolloutPercentage: 10 });
    service.update('feat-b', { rolloutPercentage: 75 });
    expect(service.getConfig('feat-b')?.rolloutPercentage).toBe(75);
  });

  it('removes a config', () => {
    service.register({ feature: 'feat-c', rolloutPercentage: 100 });
    service.remove('feat-c');
    expect(service.getConfig('feat-c')).toBeUndefined();
  });

  it('lists all registered configs', () => {
    service.register({ feature: 'x', rolloutPercentage: 0 });
    service.register({ feature: 'y', rolloutPercentage: 100 });
    expect(service.listAll()).toHaveLength(2);
  });

  // ── evaluate: unknown feature ───────────────────────────────────────

  it('returns disabled for unknown feature (safe default)', () => {
    const result = service.evaluate('unknown-feature', 'user-1');
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('excluded');
  });

  // ── evaluate: rolloutPercentage edge cases ──────────────────────────

  it('returns disabled when rolloutPercentage is 0', () => {
    service.register({ feature: 'dark', rolloutPercentage: 0 });
    const result = service.evaluate('dark', 'any-user');
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('excluded');
  });

  it('returns enabled when rolloutPercentage is 100', () => {
    service.register({ feature: 'full', rolloutPercentage: 100 });
    const result = service.evaluate('full', 'any-user');
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe('rollout');
  });

  // ── evaluate: allowlist ─────────────────────────────────────────────

  it('enables for allowlisted user even when rollout is 0', () => {
    service.register({
      feature: 'beta',
      rolloutPercentage: 0,
      allowlist: ['internal-user-1'],
    });
    const result = service.evaluate('beta', 'internal-user-1');
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe('allowlist');
  });

  it('does not enable for non-allowlisted user when rollout is 0', () => {
    service.register({
      feature: 'beta',
      rolloutPercentage: 0,
      allowlist: ['internal-user-1'],
    });
    const result = service.evaluate('beta', 'random-user');
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('excluded');
  });

  // ── evaluate: observer / shadow mode ───────────────────────────────

  it('always returns enabled in observerOnly mode regardless of rollout', () => {
    service.register({ feature: 'shadow', rolloutPercentage: 0, observerOnly: true });
    const result = service.evaluate('shadow', 'any-user');
    expect(result.enabled).toBe(true);
    expect(result.observerOnly).toBe(true);
    expect(result.reason).toBe('observer');
  });

  // ── evaluate: deterministic sticky hashing ─────────────────────────

  it('produces the same result for the same user+feature across calls', () => {
    service.register({ feature: 'sticky', rolloutPercentage: 50 });
    const r1 = service.evaluate('sticky', 'user-abc');
    const r2 = service.evaluate('sticky', 'user-abc');
    expect(r1.enabled).toBe(r2.enabled);
  });

  it('distributes users across rollout buckets (statistical smoke test)', () => {
    service.register({ feature: 'dist', rolloutPercentage: 50 });
    let enabled = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      if (service.evaluate('dist', `user-${i}`).enabled) enabled++;
    }
    // Expect roughly 50% ± 10%
    expect(enabled).toBeGreaterThan(total * 0.4);
    expect(enabled).toBeLessThan(total * 0.6);
  });
});
