// N+1 Detection TypeORM Subscriber for capturing query timing
import { EventSubscriber, EntitySubscriberInterface, QueryEvent } from 'typeorm';
import { queryCounterStore } from '../query-counter.store';

@EventSubscriber()
export class NPlus1DetectionSubscriber implements EntitySubscriberInterface {
  listenTo() {
    return '*';
  }

  beforeQuery(event: QueryEvent): boolean | void {
    if (!event.queryRunner) return;
    (event.queryRunner as any).__nplus1StartTime = Date.now();
  }

  afterQuery(event: QueryEvent): boolean | void {
    if (!event.queryRunner) return;
    const start = (event.queryRunner as any).__nplus1StartTime;
    if (start !== undefined) {
      delete (event.queryRunner as any).__nplus1StartTime;
      const durationMs = Date.now() - start;
      queryCounterStore.increment(1, durationMs);
    }
  }
}
