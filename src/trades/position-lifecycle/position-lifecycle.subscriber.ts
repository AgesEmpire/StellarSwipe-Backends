import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm';
import { Position } from '../../portfolio/entities/position.entity';
import { ArchivedPosition } from '../../portfolio/entities/archived-position.entity';
import { PositionLifecycleEventType as T, PositionLifecycleSource } from './position-lifecycle-event.entity';
import { PositionLifecycleService } from './position-lifecycle.service';

/**
 * Derives a lifecycle transition from a saved portfolio Position row, without
 * touching quantity semantics: it only observes before/after values.
 */
export function transitionForPositionUpdate(before: Partial<Position>, after: Partial<Position>): T | null {
  if (before.isActive === true && after.isActive === false) return T.CLOSED;
  if (before.isActive === false && after.isActive === true) return T.REOPENED;
  if (before.isActive !== false && after.isActive !== false && Number(after.amount) < Number(before.amount)) {
    return T.PARTIALLY_CLOSED;
  }
  return null;
}

/**
 * Records lifecycle events for the portfolio Position model (create, partial
 * close, close, reopen) and for archival (rows inserted into
 * archived_positions), inside the same transaction as the write. Uses the
 * safe recorder so lifecycle bookkeeping can never fail the position write.
 */
@Injectable()
export class PositionLifecycleSubscriber implements EntitySubscriberInterface {
  constructor(
    dataSource: DataSource,
    private readonly lifecycle: PositionLifecycleService,
  ) {
    dataSource.subscribers.push(this);
  }

  async afterInsert(event: InsertEvent<any>): Promise<void> {
    const target = event.metadata?.target;
    const entity = event.entity;
    if (!entity) return;

    if (target === ArchivedPosition) {
      const archived = entity as ArchivedPosition;
      await this.lifecycle.recordTransitionSafe(
        {
          positionId: archived.originalPositionId,
          userId: archived.userId,
          type: T.ARCHIVED,
          occurredAt: archived.archivedAt ?? new Date(),
          source: PositionLifecycleSource.PORTFOLIO_POSITION,
          idempotencyKey: `portfolio_position:${archived.originalPositionId}:archived`,
          backfill: { closedAt: archived.closedAt ? new Date(archived.closedAt) : undefined },
          metadata: { archivedPositionId: archived.id },
        },
        event.manager,
      );
      return;
    }

    if (target === Position) {
      const position = entity as Position;
      if (!position.id || position.isActive === false) return;
      await this.lifecycle.recordTransitionSafe(
        {
          positionId: position.id,
          userId: position.userId,
          type: T.OPENED,
          occurredAt: position.createdAt ?? new Date(),
          quantityAfter: position.amount,
          source: PositionLifecycleSource.PORTFOLIO_POSITION,
          idempotencyKey: `portfolio_position:${position.id}:opened`,
        },
        event.manager,
      );
    }
  }

  async afterUpdate(event: UpdateEvent<any>): Promise<void> {
    if (event.metadata?.target !== Position || !event.entity || !event.databaseEntity) return;
    const before = event.databaseEntity as Position;
    const after = event.entity as Position;
    const type = transitionForPositionUpdate(before, after);
    if (!type) return;

    await this.lifecycle.recordTransitionSafe(
      {
        positionId: before.id,
        userId: before.userId,
        type,
        occurredAt: after.updatedAt ? new Date(after.updatedAt) : new Date(),
        quantityBefore: before.amount,
        quantityAfter: after.amount ?? before.amount,
        source: PositionLifecycleSource.PORTFOLIO_POSITION,
        idempotencyKey: `portfolio_position:${before.id}:v${after.version ?? before.version}:${type}`,
        backfill: {
          openedAt: before.createdAt ? new Date(before.createdAt) : undefined,
          closedAt: type === T.REOPENED && before.updatedAt ? new Date(before.updatedAt) : undefined,
        },
      },
      event.manager,
    );
  }
}
