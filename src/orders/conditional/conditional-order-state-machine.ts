import { ConflictException } from '@nestjs/common';
import { ConditionalOrderStatus } from './dto/create-conditional-order.dto';

/**
 * Explicit allow-list of conditional-order state transitions.
 *
 * PENDING/ACTIVE are the only editable/cancellable states. TRIGGERED is a
 * transient state between condition-match and fill execution — from there
 * an order can still be cancelled (if the cancel wins the race against the
 * in-flight fill) or filled/fail. FILLED, CANCELLED, EXPIRED and FAILED are
 * terminal: nothing may transition out of them.
 */
export const ALLOWED_ORDER_TRANSITIONS: Record<ConditionalOrderStatus, ConditionalOrderStatus[]> = {
  [ConditionalOrderStatus.PENDING]: [
    ConditionalOrderStatus.ACTIVE,
    ConditionalOrderStatus.TRIGGERED,
    ConditionalOrderStatus.CANCELLED,
    ConditionalOrderStatus.EXPIRED,
  ],
  [ConditionalOrderStatus.ACTIVE]: [
    ConditionalOrderStatus.TRIGGERED,
    ConditionalOrderStatus.CANCELLED,
    ConditionalOrderStatus.EXPIRED,
  ],
  [ConditionalOrderStatus.TRIGGERED]: [
    ConditionalOrderStatus.FILLED,
    ConditionalOrderStatus.CANCELLED,
    ConditionalOrderStatus.FAILED,
  ],
  [ConditionalOrderStatus.FILLED]: [],
  [ConditionalOrderStatus.CANCELLED]: [],
  [ConditionalOrderStatus.EXPIRED]: [],
  [ConditionalOrderStatus.FAILED]: [],
};

/**
 * Throws a ConflictException (never silently no-ops) when `to` is not a
 * legal transition from `from` — this is what makes a cancel-vs-fill race
 * resolve deterministically: whichever command's transaction commits first
 * wins, and the loser's re-check under the row lock fails this assertion.
 */
export function assertTransitionAllowed(
  from: ConditionalOrderStatus,
  to: ConditionalOrderStatus,
): void {
  const allowed = ALLOWED_ORDER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictException(
      `Cannot transition conditional order from ${from} to ${to}.`,
    );
  }
}
