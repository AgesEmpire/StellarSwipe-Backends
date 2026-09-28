// N+1 Detection Query Counter using AsyncLocalStorage for per-request tracking
import { AsyncLocalStorage } from 'async_hooks';

export interface RepeatedQuery {
  /** Normalized SQL (literals and parameters stripped). */
  sql: string;
  count: number;
  /** First application frame that issued the query. */
  callSite?: string;
}

export interface QueryCounterState {
  queryCount: number;
  totalTimeMs: number;
  statements: Map<string, RepeatedQuery>;
  requestContext: {
    method: string;
    url: string;
    correlationId?: string;
  };
}

/** Collapse literals/params so identical query shapes group together. */
export function normalizeQuery(sql: string): string {
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\(\s*\?(\s*,\s*\?)*\s*\)/g, '(?)')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First stack frame inside src/ that isn't the detector itself or node_modules. */
export function captureCallSite(): string | undefined {
  const stack = new Error().stack?.split('\n').slice(2) ?? [];
  const frame = stack.find(
    (line) =>
      !line.includes('node_modules') &&
      !line.includes('node:') &&
      !/query-counter\.store|nplus1-detection/.test(line) &&
      /src[\\/]/.test(line),
  );
  return frame?.trim().replace(/^at\s+/, '');
}

export class QueryCounterStore {
  private readonly als = new AsyncLocalStorage<QueryCounterState>();

  run<T>(
    context: QueryCounterState['requestContext'],
    fn: () => T,
  ): T {
    return this.als.run(
      { queryCount: 0, totalTimeMs: 0, statements: new Map(), requestContext: context },
      fn,
    );
  }

  get snapshot(): Readonly<QueryCounterState> | undefined {
    return this.als.getStore();
  }

  increment(count: number, durationMs: number, sql?: string, callSite?: string): void {
    const store = this.als.getStore();
    if (!store) return;
    store.queryCount += count;
    store.totalTimeMs += durationMs;
    if (sql) {
      const key = normalizeQuery(sql);
      const entry = store.statements.get(key);
      if (entry) {
        entry.count += count;
        entry.callSite ??= callSite;
      } else {
        store.statements.set(key, { sql: key, count, callSite });
      }
    }
  }

  /** Query shapes executed at least `threshold` times in the current context. */
  repeated(threshold: number, allowlist: RegExp[] = []): RepeatedQuery[] {
    const store = this.als.getStore();
    if (!store) return [];
    return [...store.statements.values()]
      .filter((q) => q.count >= threshold && !allowlist.some((re) => re.test(q.sql)))
      .sort((a, b) => b.count - a.count);
  }
}

export const queryCounterStore = new QueryCounterStore();

export class NPlusOneDetectedError extends Error {
  constructor(public readonly offenders: RepeatedQuery[]) {
    super(
      'N+1 query pattern detected:\n' +
        offenders
          .map((q) => `  ${q.count}x ${q.sql}${q.callSite ? `\n    at ${q.callSite}` : ''}`)
          .join('\n'),
    );
    this.name = 'NPlusOneDetectedError';
  }
}

/**
 * Test helper: run `fn` with query tracking and throw if any query shape
 * repeats `threshold` or more times (and isn't allowlisted).
 */
export async function assertNoNPlusOne<T>(
  fn: () => Promise<T>,
  options: { threshold?: number; allowlist?: RegExp[] } = {},
): Promise<T> {
  const threshold = options.threshold ?? 5;
  return queryCounterStore.run({ method: 'TEST', url: 'assertNoNPlusOne' }, async () => {
    const result = await fn();
    const offenders = queryCounterStore.repeated(threshold, options.allowlist);
    if (offenders.length) throw new NPlusOneDetectedError(offenders);
    return result;
  });
}
