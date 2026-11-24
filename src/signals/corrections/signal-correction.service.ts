import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, MoreThan } from 'typeorm';
import { Signal, SignalStatus } from '../entities/signal.entity';
import { SignalVersion } from '../versions/entities/signal-version.entity';
import {
  SignalCorrectionEvent,
  SignalLifecycleEventType,
} from './signal-correction-event.entity';

export const CORRECTABLE_FIELDS = ['entryPrice', 'targetPrice', 'stopLossPrice', 'rationale'] as const;
type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export interface CorrectSignalInput {
  reason: string;
  entryPrice?: string;
  targetPrice?: string;
  stopLossPrice?: string;
  rationale?: string;
  /** Makes client retries safe: the same key returns the original event. */
  idempotencyKey?: string;
}

/** Payload emitted on `signal.corrected`. */
export interface SignalCorrectedEventPayload {
  eventType: SignalLifecycleEventType.CORRECTED;
  eventId: string;
  signalId: string;
  providerId: string;
  sequence: number;
  previousVersion: { id: string; number: number };
  replacementVersion: { id: string; number: number };
  reason: string;
  changes: SignalCorrectionEvent['changes'];
  occurredAt: Date;
  replayed: boolean;
}

const MIN_REASON_LENGTH = 5;
const CORRECTABLE_STATUSES = new Set([SignalStatus.ACTIVE]);

@Injectable()
export class SignalCorrectionService {
  private readonly logger = new Logger(SignalCorrectionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  async correct(
    signalId: string,
    providerId: string,
    input: CorrectSignalInput,
  ): Promise<SignalCorrectedEventPayload> {
    const reason = (input.reason ?? '').trim();
    if (reason.length < MIN_REASON_LENGTH) {
      throw new BadRequestException(`A correction reason of at least ${MIN_REASON_LENGTH} characters is required`);
    }
    if (!CORRECTABLE_FIELDS.some((f) => input[f] !== undefined)) {
      throw new BadRequestException(`At least one of ${CORRECTABLE_FIELDS.join(', ')} must be corrected`);
    }

    const { event, created } = await this.dataSource.transaction((manager) =>
      this.correctInTransaction(manager, signalId, providerId, { ...input, reason }),
    );

    const payload = toPayload(event, false);
    if (created) {
      // Emit only after commit so consumers never see an uncommitted correction.
      this.events.emit(SignalLifecycleEventType.CORRECTED, payload);
    }
    return payload;
  }

  /** Corrections in sequence order, optionally after a cursor — the replay source of truth. */
  async listCorrections(signalId: string, afterSequence = 0): Promise<SignalCorrectionEvent[]> {
    return this.dataSource.getRepository(SignalCorrectionEvent).find({
      where: { signalId, sequence: MoreThan(afterSequence) },
      order: { sequence: 'ASC' },
    });
  }

  /** Re-emits stored corrections in their original order, flagged `replayed`. */
  async replay(signalId: string, afterSequence = 0): Promise<SignalCorrectedEventPayload[]> {
    const events = await this.listCorrections(signalId, afterSequence);
    const payloads = events.map((e) => toPayload(e, true));
    for (const p of payloads) this.events.emit(SignalLifecycleEventType.CORRECTED, p);
    return payloads;
  }

  private async correctInTransaction(
    manager: EntityManager,
    signalId: string,
    providerId: string,
    input: CorrectSignalInput & { reason: string },
  ): Promise<{ event: SignalCorrectionEvent; created: boolean }> {
    const signalRepo = manager.getRepository(Signal);
    const versionRepo = manager.getRepository(SignalVersion);
    const eventRepo = manager.getRepository(SignalCorrectionEvent);

    // Row lock serialises corrections per signal so sequence/version numbers stay ordered.
    const signal = await signalRepo.findOne({
      where: { id: signalId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!signal) throw new NotFoundException(`Signal ${signalId} not found`);
    if (signal.providerId !== providerId) {
      this.logger.warn(`Rejected correction of signal ${signalId} by non-owner ${providerId}`);
      throw new ForbiddenException('Only the publishing provider can correct this signal');
    }

    if (input.idempotencyKey) {
      const existing = await eventRepo.findOne({
        where: { signalId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { event: existing, created: false };
    }

    if (!CORRECTABLE_STATUSES.has(signal.status)) {
      throw new BadRequestException(`Cannot correct a signal in status ${signal.status}`);
    }

    const changes: SignalCorrectionEvent['changes'] = {};
    for (const field of CORRECTABLE_FIELDS) {
      const next = input[field];
      const prev = (signal[field] as string | null | undefined) ?? null;
      if (next !== undefined && next !== prev) changes[field] = { from: prev, to: next };
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Correction does not change any field');
    }

    // Previous version: latest stored version, or a baseline snapshot of the
    // originally published state if the signal has never been versioned.
    let previous = await versionRepo.findOne({
      where: { signalId },
      order: { versionNumber: 'DESC' },
    });
    if (!previous) {
      previous = await versionRepo.save(
        versionRepo.create({
          signalId,
          providerId,
          versionNumber: signal.version ?? 1,
          entryPrice: signal.entryPrice ?? null,
          targetPrice: signal.targetPrice ?? null,
          stopLossPrice: signal.stopLossPrice ?? null,
          rationale: signal.rationale ?? null,
          changeSummary: 'Baseline snapshot of published signal',
          requiresApproval: false,
        }),
      );
    }

    const replacement = await versionRepo.save(
      versionRepo.create({
        signalId,
        providerId,
        versionNumber: previous.versionNumber + 1,
        entryPrice: pick(input, signal, 'entryPrice'),
        targetPrice: pick(input, signal, 'targetPrice'),
        stopLossPrice: pick(input, signal, 'stopLossPrice'),
        rationale: pick(input, signal, 'rationale'),
        changeSummary: `Correction: ${input.reason}`,
        requiresApproval: false,
      }),
    );

    for (const field of Object.keys(changes) as CorrectableField[]) {
      (signal as any)[field] = changes[field].to;
    }
    signal.version = replacement.versionNumber;
    await signalRepo.save(signal);

    const last = await eventRepo.findOne({ where: { signalId }, order: { sequence: 'DESC' } });
    const event = await eventRepo.save(
      eventRepo.create({
        eventType: SignalLifecycleEventType.CORRECTED,
        signalId,
        providerId,
        sequence: (last?.sequence ?? 0) + 1,
        previousVersionId: previous.id,
        previousVersionNumber: previous.versionNumber,
        replacementVersionId: replacement.id,
        replacementVersionNumber: replacement.versionNumber,
        reason: input.reason,
        changes,
        idempotencyKey: input.idempotencyKey ?? null,
      }),
    );
    return { event, created: true };
  }
}

function pick(input: CorrectSignalInput, signal: Signal, field: CorrectableField): string | null {
  return input[field] ?? ((signal[field] as string | null | undefined) ?? null);
}

function toPayload(e: SignalCorrectionEvent, replayed: boolean): SignalCorrectedEventPayload {
  return {
    eventType: SignalLifecycleEventType.CORRECTED,
    eventId: e.id,
    signalId: e.signalId,
    providerId: e.providerId,
    sequence: e.sequence,
    previousVersion: { id: e.previousVersionId, number: e.previousVersionNumber },
    replacementVersion: { id: e.replacementVersionId, number: e.replacementVersionNumber },
    reason: e.reason,
    changes: e.changes,
    occurredAt: e.createdAt,
    replayed,
  };
}
