import { ConfigService } from '@nestjs/config';
import { HorizonBulkheadService } from './horizon-bulkhead.service';
import { HorizonCallCategory } from './horizon-bulkhead.types';
import { BulkheadRejectedError } from './bulkhead';
import { HorizonBulkheadConfig } from '../../config/schemas/config.interface';

/** A deferred promise whose resolution we control from the test. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildService(config: HorizonBulkheadConfig): HorizonBulkheadService {
  const configService = {
    get: (key: string) =>
      key === 'stellar.horizonBulkhead' ? config : undefined,
  } as unknown as ConfigService;
  return new HorizonBulkheadService(configService);
}

describe('HorizonBulkheadService', () => {
  it('isolates categories: saturating WRITE leaves READ responsive', async () => {
    const service = buildService({
      write: { maxConcurrent: 1, maxQueue: 1 },
      read: { maxConcurrent: 5, maxQueue: 10 },
    });

    // Saturate the write bulkhead: 1 in-flight + 1 queued = full.
    const inflight = deferred();
    const queued = deferred();

    const writeInflight = service.write(() => inflight.promise);
    const writeQueued = service.write(() => queued.promise);

    // Third write must be rejected — write pool + queue are both full.
    await expect(service.write(() => Promise.resolve('nope'))).rejects.toBeInstanceOf(
      BulkheadRejectedError,
    );

    // ...but a READ call completes immediately despite write saturation.
    await expect(service.read(() => Promise.resolve('read-ok'))).resolves.toBe(
      'read-ok',
    );

    const writeMetrics = service.getMetrics(HorizonCallCategory.WRITE)!;
    expect(writeMetrics.active).toBe(1);
    expect(writeMetrics.queued).toBe(1);
    expect(writeMetrics.totalRejected).toBe(1);

    // Drain the in-flight + queued writes so the test ends cleanly.
    inflight.resolve();
    await writeInflight;
    queued.resolve();
    await writeQueued;
  });

  it('queues calls beyond maxConcurrent and admits them as slots free up', async () => {
    const service = buildService({
      write: { maxConcurrent: 1, maxQueue: 5 },
      read: { maxConcurrent: 1, maxQueue: 5 },
    });

    const order: number[] = [];
    const gate1 = deferred();
    const gate2 = deferred();

    const p1 = service.read(async () => {
      await gate1.promise;
      order.push(1);
    });
    const p2 = service.read(async () => {
      await gate2.promise;
      order.push(2);
    });

    // Only one read runs at a time → the second is queued.
    expect(service.getMetrics(HorizonCallCategory.READ)!.queued).toBe(1);

    gate1.resolve();
    await p1;
    gate2.resolve();
    await p2;

    expect(order).toEqual([1, 2]);
    expect(service.getMetrics(HorizonCallCategory.READ)!.totalAdmitted).toBe(2);
  });
});
