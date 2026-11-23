import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Contest, ContestStatus } from './entities/contest.entity';
import {
  ContestEventDisposition,
  ContestResultCorrection,
  ContestTradeEvent,
} from './entities/contest-trade-event.entity';
import { classifyContestEvent, DEFAULT_INGESTION_GRACE_MS } from './contest-event-cutoff.policy';

export interface IncomingContestTradeEvent {
  contestId: string;
  eventId: string;
  providerId: string;
  eventTime: Date;
  scoreDelta: number;
  /** Defaults to the processing time if the transport did not stamp it. */
  ingestedAt?: Date;
}

export interface IngestResult {
  event: ContestTradeEvent;
  disposition: ContestEventDisposition;
  duplicate: boolean;
}

export interface CorrectionActor {
  id: string;
  roles?: string[];
  permissions?: string[];
}

export const CONTEST_CORRECTION_PERMISSION = 'contests:admin';

/**
 * Guards published contest results against late / replayed trade events and
 * provides the explicit, audited correction workflow (#1524).
 */
@Injectable()
export class ContestResultIntegrityService {
  private readonly logger = new Logger(ContestResultIntegrityService.name);

  constructor(
    @InjectRepository(Contest)
    private readonly contests: Repository<Contest>,
    @InjectRepository(ContestTradeEvent)
    private readonly events: Repository<ContestTradeEvent>,
    @InjectRepository(ContestResultCorrection)
    private readonly corrections: Repository<ContestResultCorrection>,
  ) {}

  private async loadContest(contestId: string): Promise<Contest> {
    const contest = await this.contests.findOne({ where: { id: contestId } });
    if (!contest) throw new NotFoundException(`Contest ${contestId} not found`);
    return contest;
  }

  /**
   * Records a trade event. Replays (same contestId + eventId) are no-ops that
   * return the original disposition. Never mutates published scores.
   */
  async ingestTradeEvent(
    input: IncomingContestTradeEvent,
    graceMs = DEFAULT_INGESTION_GRACE_MS,
  ): Promise<IngestResult> {
    if (!Number.isFinite(input.scoreDelta)) {
      throw new BadRequestException('scoreDelta must be a finite number');
    }
    const existing = await this.events.findOne({
      where: { contestId: input.contestId, eventId: input.eventId },
    });
    if (existing) {
      return { event: existing, disposition: existing.disposition, duplicate: true };
    }

    const contest = await this.loadContest(input.contestId);
    const ingestedAt = input.ingestedAt ?? new Date();
    const disposition = classifyContestEvent(
      contest,
      { eventTime: input.eventTime, ingestedAt },
      graceMs,
    );

    const event = this.events.create({
      contestId: input.contestId,
      eventId: input.eventId,
      providerId: input.providerId,
      eventTime: input.eventTime,
      ingestedAt,
      scoreDelta: input.scoreDelta,
      disposition,
      correctionId: null,
    });
    try {
      await this.events.insert(event);
    } catch (err) {
      // Concurrent replay won the unique (contestId, eventId) race.
      const winner = await this.events.findOne({
        where: { contestId: input.contestId, eventId: input.eventId },
      });
      if (winner) return { event: winner, disposition: winner.disposition, duplicate: true };
      throw err;
    }

    if (disposition === ContestEventDisposition.PENDING_CORRECTION) {
      this.logger.warn(
        `Late event ${input.eventId} for contest ${input.contestId} quarantined for correction`,
      );
    }
    return { event, disposition, duplicate: false };
  }

  /** Live scores from accepted events (pre-finalization view). */
  async computeAcceptedScores(contestId: string): Promise<Record<string, number>> {
    const accepted = await this.events.find({
      where: { contestId, disposition: ContestEventDisposition.ACCEPTED },
    });
    return accepted.reduce<Record<string, number>>((acc, e) => {
      acc[e.providerId] = (acc[e.providerId] ?? 0) + Number(e.scoreDelta);
      return acc;
    }, {});
  }

  /** Publishes revision 1 of the results. Can only happen once. */
  async publishResults(contestId: string, now: Date = new Date()): Promise<Contest> {
    const contest = await this.loadContest(contestId);
    if ((contest.resultRevision ?? 0) > 0) {
      throw new ConflictException('Contest results already published');
    }
    if (now.getTime() < new Date(contest.endTime).getTime()) {
      throw new BadRequestException('Contest has not ended yet');
    }
    contest.publishedScores = await this.computeAcceptedScores(contestId);
    contest.resultRevision = 1;
    contest.status = ContestStatus.FINALIZED;
    contest.finalizedAt = contest.finalizedAt ?? now;
    return this.contests.save(contest);
  }

  async getPublishedResults(
    contestId: string,
  ): Promise<{ revision: number; scores: Record<string, number>; finalizedAt: Date | null }> {
    const contest = await this.loadContest(contestId);
    return {
      revision: contest.resultRevision ?? 0,
      scores: { ...(contest.publishedScores ?? {}) },
      finalizedAt: contest.finalizedAt ?? null,
    };
  }

  async listPendingCorrections(contestId: string): Promise<ContestTradeEvent[]> {
    return this.events.find({
      where: { contestId, disposition: ContestEventDisposition.PENDING_CORRECTION },
      order: { eventTime: 'ASC' },
    });
  }

  private isAuthorized(actor: CorrectionActor | undefined): boolean {
    if (!actor?.id) return false;
    return (
      (actor.permissions ?? []).includes(CONTEST_CORRECTION_PERMISSION) ||
      (actor.roles ?? []).includes('admin')
    );
  }

  /**
   * Explicit correction workflow: applies selected quarantined events to the
   * published results, bumps the revision and writes an audit record.
   */
  async applyCorrection(
    contestId: string,
    eventIds: string[],
    actor: CorrectionActor,
    reason: string,
    expectedRevision?: number,
  ): Promise<ContestResultCorrection> {
    if (!this.isAuthorized(actor)) {
      throw new ForbiddenException('Not authorized to correct contest results');
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A correction reason is required');
    }
    const ids = Array.from(new Set(eventIds ?? []));
    if (ids.length === 0) throw new BadRequestException('eventIds must not be empty');

    const contest = await this.loadContest(contestId);
    const fromRevision = contest.resultRevision ?? 0;
    if (contest.status !== ContestStatus.FINALIZED || fromRevision < 1) {
      throw new BadRequestException('Only published contest results can be corrected');
    }
    if (expectedRevision !== undefined && expectedRevision !== fromRevision) {
      throw new ConflictException(
        `Result revision is ${fromRevision}, expected ${expectedRevision}`,
      );
    }

    const events = await this.events.find({ where: { contestId, eventId: In(ids) } });
    const missing = ids.filter((id) => !events.some((e) => e.eventId === id));
    if (missing.length) {
      throw new NotFoundException(`Unknown events: ${missing.join(', ')}`);
    }
    const notPending = events.filter(
      (e) => e.disposition !== ContestEventDisposition.PENDING_CORRECTION,
    );
    if (notPending.length) {
      throw new BadRequestException(
        `Events not pending correction: ${notPending.map((e) => e.eventId).join(', ')}`,
      );
    }

    const previousScores = { ...(contest.publishedScores ?? {}) };
    const newScores = { ...previousScores };
    for (const e of events) {
      newScores[e.providerId] = (newScores[e.providerId] ?? 0) + Number(e.scoreDelta);
    }

    const correction = this.corrections.create({
      contestId,
      actorId: actor.id,
      reason: reason.trim(),
      eventIds: ids,
      fromRevision,
      toRevision: fromRevision + 1,
      previousScores,
      newScores,
    });
    // unique (contestId, toRevision) rejects a concurrent correction
    try {
      await this.corrections.insert(correction);
    } catch {
      throw new ConflictException('Contest results were corrected concurrently; retry');
    }

    for (const e of events) {
      e.disposition = ContestEventDisposition.CORRECTION_APPLIED;
      e.correctionId = correction.id;
    }
    await this.events.save(events);

    contest.publishedScores = newScores;
    contest.resultRevision = fromRevision + 1;
    await this.contests.save(contest);

    this.logger.log(
      `Contest ${contestId} results corrected to revision ${contest.resultRevision} by ${actor.id}`,
    );
    return correction;
  }
}
