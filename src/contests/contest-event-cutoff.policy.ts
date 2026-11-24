import { Contest, ContestStatus } from './entities/contest.entity';
import { ContestEventDisposition } from './entities/contest-trade-event.entity';

/** Default grace period after `endTime` for in-flight events to arrive. */
export const DEFAULT_INGESTION_GRACE_MS = 5 * 60 * 1000;

export interface CutoffEventTimes {
  eventTime: Date;
  ingestedAt: Date;
}

/**
 * Finalization cutoff policy (#1524). Applied identically to every event:
 *
 * 1. Event time must fall in `[startTime, endTime)`; otherwise the event is
 *    EXCLUDED_OUT_OF_WINDOW and never counts, even via correction.
 * 2. Ingestion cutoff = min(endTime + grace, finalizedAt). An in-window event
 *    ingested after the cutoff, or processed once results are FINALIZED, is
 *    PENDING_CORRECTION: it is recorded but never silently changes published
 *    scores. Only an authorized correction can apply it.
 * 3. Otherwise ACCEPTED.
 */
export function ingestionCutoff(
  contest: Pick<Contest, 'endTime' | 'finalizedAt'>,
  graceMs = DEFAULT_INGESTION_GRACE_MS,
): Date {
  const graceCutoff = new Date(contest.endTime).getTime() + graceMs;
  const finalized = contest.finalizedAt ? new Date(contest.finalizedAt).getTime() : Infinity;
  return new Date(Math.min(graceCutoff, finalized));
}

export function classifyContestEvent(
  contest: Pick<Contest, 'startTime' | 'endTime' | 'finalizedAt' | 'status'>,
  event: CutoffEventTimes,
  graceMs = DEFAULT_INGESTION_GRACE_MS,
): ContestEventDisposition {
  const t = event.eventTime.getTime();
  if (t < new Date(contest.startTime).getTime() || t >= new Date(contest.endTime).getTime()) {
    return ContestEventDisposition.EXCLUDED_OUT_OF_WINDOW;
  }
  if (contest.status === ContestStatus.FINALIZED) {
    return ContestEventDisposition.PENDING_CORRECTION;
  }
  if (event.ingestedAt.getTime() > ingestionCutoff(contest, graceMs).getTime()) {
    return ContestEventDisposition.PENDING_CORRECTION;
  }
  return ContestEventDisposition.ACCEPTED;
}
