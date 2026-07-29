import {
  EventSubscriber,
  EntitySubscriberInterface,
  RemoveEvent,
  SoftRemoveEvent,
  RecoverEvent,
} from 'typeorm';

@EventSubscriber()
export class SoftDeleteSubscriber implements EntitySubscriberInterface {
  beforeRemove(event: RemoveEvent<any>): void {
    const entity = event.entity;
    if (entity && typeof entity === 'object' && 'deletedAt' in entity) {
      event.manager.softRemove(entity);
      event.metadata = { ...event.metadata, softDelete: true };
    }
  }

  beforeSoftRemove(event: SoftRemoveEvent<any>): void {
    const entity = event.entity;
    if (entity && typeof entity === 'object' && 'deletedAt' in entity) {
      (entity as any).deletedAt = new Date();
    }
  }

  afterRecover(event: RecoverEvent<any>): void {
    const entity = event.entity;
    if (entity && typeof entity === 'object' && 'deletedAt' in entity) {
      (entity as any).deletedAt = null;
    }
  }
}
