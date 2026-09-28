// N+1 Detection TypeORM Subscriber for capturing query timing
import { EventSubscriber, EntitySubscriberInterface, QueryEvent } from 'typeorm';
import { captureCallSite, queryCounterStore } from '../query-counter.store';

@EventSubscriber()
export class NPlus1DetectionSubscriber implements EntitySubscriberInterface {
  listenTo() {
    return '*';
  }

  beforeQuery(event: QueryEvent): boolean | void {
    if (!event.queryRunner) return;
    (event.queryRunner as any).__nplus1StartTime = Date.now();
    // Stack capture is only paid while a request/test is being tracked.
    (event.queryRunner as any).__nplus1CallSite = queryCounterStore.snapshot
      ? captureCallSite()
      : undefined;
  }

  afterQuery(event: QueryEvent): boolean | void {
    if (!event.queryRunner) return;
    const start = (event.queryRunner as any).__nplus1StartTime;
    if (start !== undefined) {
      const callSite = (event.queryRunner as any).__nplus1CallSite;
      delete (event.queryRunner as any).__nplus1StartTime;
      delete (event.queryRunner as any).__nplus1CallSite;
      const durationMs = Date.now() - start;
      queryCounterStore.increment(1, durationMs, event.query, callSite);
    }
  }
}
