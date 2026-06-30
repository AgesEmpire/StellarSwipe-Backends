// N+1 Detection Query Counter using AsyncLocalStorage for per-request tracking
import { AsyncLocalStorage } from 'async_hooks';

export interface QueryCounterState {
  queryCount: number;
  totalTimeMs: number;
  requestContext: {
    method: string;
    url: string;
    correlationId?: string;
  };
}

export class QueryCounterStore {
  private readonly als = new AsyncLocalStorage<QueryCounterState>();

  run<T>(
    context: QueryCounterState['requestContext'],
    fn: () => T,
  ): T {
    return this.als.run(
      { queryCount: 0, totalTimeMs: 0, requestContext: context },
      fn,
    );
  }

  get snapshot(): Readonly<QueryCounterState> | undefined {
    return this.als.getStore();
  }

  increment(count: number, durationMs: number): void {
    const store = this.als.getStore();
    if (store) {
      store.queryCount += count;
      store.totalTimeMs += durationMs;
    }
  }
}

export const queryCounterStore = new QueryCounterStore();
