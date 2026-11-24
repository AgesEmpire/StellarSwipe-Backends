import { BadRequestException, ConflictException } from '@nestjs/common';
import { PositionLifecycleEventType as T } from './position-lifecycle-event.entity';

export type PositionLifecycleState = 'none' | 'open' | 'closed' | 'archived';

export interface LifecycleEventLike {
  eventType: T;
  occurredAt: Date;
  inferred?: boolean;
}

export interface PlannedLifecycleEvent {
  eventType: T;
  occurredAt: Date;
  inferred: boolean;
}

export interface LifecycleBackfill {
  /** Known open time for a position that has no history yet. */
  openedAt?: Date;
  /** Known close time for a legacy position being reopened/archived with no CLOSED event. */
  closedAt?: Date;
}

/**
 * Allowed transitions. PARTIALLY_CLOSED keeps the position open; REOPENED
 * starts a new open cycle after a full close; ARCHIVED is terminal and only
 * valid for a closed position.
 */
export const ALLOWED_POSITION_TRANSITIONS: Record<PositionLifecycleState, T[]> = {
  none: [T.OPENED],
  open: [T.PARTIALLY_CLOSED, T.CLOSED],
  closed: [T.REOPENED, T.ARCHIVED],
  archived: [],
};

const NEXT_STATE: Record<T, PositionLifecycleState> = {
  [T.OPENED]: 'open',
  [T.PARTIALLY_CLOSED]: 'open',
  [T.CLOSED]: 'closed',
  [T.REOPENED]: 'open',
  [T.ARCHIVED]: 'archived',
};

const REQUIRES_CLOSED: T[] = [T.REOPENED, T.ARCHIVED];

export function deriveState(history: LifecycleEventLike[]): PositionLifecycleState {
  return history.reduce<PositionLifecycleState>((_s, e) => NEXT_STATE[e.eventType], 'none');
}

function invalid(from: PositionLifecycleState, to: T): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'INVALID_POSITION_TRANSITION',
    message: `Cannot record ${to} for a position in state ${from}`,
  });
}

/**
 * Plans the rows to append for `target`, including back-filled prerequisites
 * for positions that predate tracking. Throws (and plans nothing) when the
 * transition is not allowed or would make timestamps go backwards.
 */
export function planTransition(
  history: LifecycleEventLike[],
  target: { eventType: T; occurredAt: Date },
  backfill?: LifecycleBackfill,
): PlannedLifecycleEvent[] {
  let state = deriveState(history);
  const planned: PlannedLifecycleEvent[] = [];
  const onlyInferred = history.every((e) => e.inferred);

  if (state === 'none' && target.eventType !== T.OPENED && backfill?.openedAt) {
    planned.push({ eventType: T.OPENED, occurredAt: backfill.openedAt, inferred: true });
    state = 'open';
  }
  if (REQUIRES_CLOSED.includes(target.eventType) && backfill?.closedAt && onlyInferred && (state === 'none' || state === 'open')) {
    planned.push({ eventType: T.CLOSED, occurredAt: backfill.closedAt, inferred: true });
    state = 'closed';
  }

  if (!ALLOWED_POSITION_TRANSITIONS[state].includes(target.eventType)) {
    throw invalid(state, target.eventType);
  }
  planned.push({ eventType: target.eventType, occurredAt: target.occurredAt, inferred: false });

  let last = history.length ? history[history.length - 1].occurredAt.getTime() : -Infinity;
  for (const e of planned) {
    if (Number.isNaN(e.occurredAt.getTime())) {
      throw new BadRequestException('Lifecycle timestamps must be valid dates');
    }
    if (e.occurredAt.getTime() < last) {
      throw new ConflictException({
        statusCode: 409,
        code: 'POSITION_TRANSITION_OUT_OF_ORDER',
        message: `${e.eventType} at ${e.occurredAt.toISOString()} is earlier than the previous transition`,
      });
    }
    last = e.occurredAt.getTime();
  }
  return planned;
}
