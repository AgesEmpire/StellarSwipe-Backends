import { CredentialStoreService } from './credential-store.service';

describe('CredentialStoreService', () => {
  let store: CredentialStoreService;

  beforeEach(() => {
    store = new CredentialStoreService();
  });

  it('returns the current credential value for new operations', () => {
    store.set('db', 'v1');
    expect(store.get('db')).toBe('v1');
  });

  it('atomically replaces the credential so new operations use the replacement', () => {
    store.set('db', 'v1');
    store.rotate('db', 'v2');
    expect(store.get('db')).toBe('v2');
  });

  it('keeps the previous credential available during the overlap window', () => {
    store.set('db', 'v1');
    store.rotate('db', 'v2', { overlapMs: 1000 });
    expect(store.get('db')).toBe('v2');
    expect(store.getPrevious('db')).toBe('v1');
  });

  it('expires the previous credential after the overlap window', () => {
    jest.useFakeTimers();
    store.set('db', 'v1');
    store.rotate('db', 'v2', { overlapMs: 1000 });
    jest.advanceTimersByTime(1001);
    expect(store.getPrevious('db')).toBeUndefined();
    jest.useRealTimers();
  });

  it('rolls back to the previous credential when rotation fails', () => {
    store.set('db', 'v1');
    expect(() =>
      store.rotate('db', 'v2', {
        validate: () => {
          throw new Error('invalid credential');
        },
      }),
    ).toThrow('invalid credential');
    expect(store.get('db')).toBe('v1');
  });

  it('emits a rotation event without exposing secret values', () => {
    const events: Array<Record<string, unknown>> = [];
    store.onRotation((event) => events.push(event));
    store.set('db', 'v1');
    store.rotate('db', 'v2');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: 'db', status: 'rotated' });
    expect(JSON.stringify(events[0])).not.toContain('v1');
    expect(JSON.stringify(events[0])).not.toContain('v2');
  });

  it('reports rotation status without secret values', () => {
    store.set('db', 'v1');
    store.rotate('db', 'v2');
    const status = store.status('db');
    expect(status).toMatchObject({ name: 'db', hasValue: true });
    expect(JSON.stringify(status)).not.toContain('v1');
    expect(JSON.stringify(status)).not.toContain('v2');
  });
});
