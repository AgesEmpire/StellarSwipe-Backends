import { CorrelationIdStore } from './correlation-id.store';

describe('CorrelationIdStore', () => {
  let store: CorrelationIdStore;

  beforeEach(() => {
    store = new CorrelationIdStore();
  });

  it('returns undefined when accessed outside of a run() context', () => {
    expect(store.getCorrelationId()).toBeUndefined();
    expect(store.getContext()).toBeUndefined();
  });

  it('exposes the correlation ID set for the current run', () => {
    store.run({ correlationId: 'abc-123' }, () => {
      expect(store.getCorrelationId()).toBe('abc-123');
    });
  });

  it('isolates concurrent contexts from each other', async () => {
    const seenIds: string[] = [];

    await Promise.all([
      store.run({ correlationId: 'first' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seenIds.push(store.getCorrelationId()!);
      }),
      store.run({ correlationId: 'second' }, async () => {
        seenIds.push(store.getCorrelationId()!);
      }),
    ]);

    expect(seenIds.sort()).toEqual(['first', 'second']);
  });

  it('clears the context once run() resolves', () => {
    store.run({ correlationId: 'temporary' }, () => {});
    expect(store.getCorrelationId()).toBeUndefined();
  });
});
