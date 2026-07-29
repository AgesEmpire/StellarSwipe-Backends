/**
 * EventReplayService
 *
 * Provides audit reconstruction by replaying persisted audit-log events
 * through the application's event bus.
 *
 * Use cases
 * ─────────
 * • Rebuild derived state (e.g. portfolio snapshots, leaderboard scores)
 *   after a data-loss incident.
 * • Replay a specific user's action history for compliance investigation.
 * • Dry-run replay to verify event handler idempotency before a migration.
 *
 * Security
 * ────────
 * • Replay is an admin-only operation — callers must pass a validated
 *   admin context; the service does NOT perform auth itself but exposes
 *   a guard-friendly interface.
 * • Sensitive metadata fields are redacted before re-emission (same rules
 *   as AuditService.sanitizeMetadata).
 * • Each replay session is assigned a unique correlationId so replayed
 *   events can be distinguished from live events in downstream handlers.
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { AuditLog, AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';

export interface ReplayOptions {
  /** Replay events for a specific user only. */
  userId?: string;
  /** Replay events for a specific resource type (e.g. 'signal', 'trade'). */
  resource?: string;
  /** Replay events for a specific resource instance. */
  resourceId?: string;
  /** Filter by action type. */
  action?: AuditAction;
  /** Start of the replay window (inclusive). */
  from: Date;
  /** End of the replay window (inclusive). */
  to: Date;
  /**
   * When true the events are emitted to the bus.
   * When false (dry-run) only the list of events is returned without emission.
   */
  dryRun?: boolean;
  /** Delay in ms between each emitted event to avoid overwhelming consumers. */
  throttleMs?: number;
}

export interface ReplayResult {
  sessionId: string;
  totalEvents: number;
  replayed: number;
  skipped: number;
  dryRun: boolean;
  startedAt: Date;
  completedAt: Date;
  errors: Array<{ eventId: string; message: string }>;
}

/** Event name emitted on the bus for each replayed audit entry. */
export const REPLAY_EVENT = 'audit.event.replayed';

/** Event name emitted when a replay session completes. */
export const REPLAY_COMPLETE_EVENT = 'audit.replay.complete';

const SENSITIVE_FIELDS = ['password', 'token', 'apiKey', 'secret', 'privateKey', 'mnemonic'];
const MAX_REPLAY_WINDOW_DAYS = 90;
const DEFAULT_THROTTLE_MS = 10;

@Injectable()
export class EventReplayService {
  private readonly logger = new Logger(EventReplayService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,

    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Replay audit events matching the given options.
   *
   * Events are emitted in chronological order (oldest first) so that
   * downstream handlers can reconstruct state correctly.
   */
  async replay(options: ReplayOptions): Promise<ReplayResult> {
    this.validateOptions(options);

    const sessionId = uuidv4();
    const startedAt = new Date();
    const errors: ReplayResult['errors'] = [];

    this.logger.log(
      `Replay session ${sessionId} started. ` +
        `Window: ${options.from.toISOString()} → ${options.to.toISOString()}. ` +
        `DryRun: ${options.dryRun ?? false}`,
    );

    const events = await this.fetchEvents(options);
    let replayed = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        if (!options.dryRun) {
          await this.emitReplayedEvent(event, sessionId, options.throttleMs);
        }
        replayed++;
      } catch (err) {
        this.logger.error(
          `Replay error for event ${event.id}: ${(err as Error).message}`,
        );
        errors.push({ eventId: event.id, message: (err as Error).message });
        skipped++;
      }
    }

    const completedAt = new Date();
    const result: ReplayResult = {
      sessionId,
      totalEvents: events.length,
      replayed,
      skipped,
      dryRun: options.dryRun ?? false,
      startedAt,
      completedAt,
      errors,
    };

    this.eventEmitter.emit(REPLAY_COMPLETE_EVENT, result);

    this.logger.log(
      `Replay session ${sessionId} complete. ` +
        `Replayed: ${replayed}, Skipped: ${skipped}, Errors: ${errors.length}`,
    );

    return result;
  }

  /**
   * Preview events that would be replayed without emitting them.
   * Equivalent to calling replay() with dryRun: true.
   */
  async preview(options: Omit<ReplayOptions, 'dryRun'>): Promise<AuditLog[]> {
    this.validateOptions({ ...options, dryRun: true });
    return this.fetchEvents(options);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchEvents(options: ReplayOptions): Promise<AuditLog[]> {
    const where: FindOptionsWhere<AuditLog> = {
      createdAt: Between(options.from, options.to),
    };

    if (options.userId) where.userId = options.userId;
    if (options.resource) where.resource = options.resource;
    if (options.resourceId) where.resourceId = options.resourceId;
    if (options.action) where.action = options.action;

    return this.auditLogRepo.find({
      where,
      order: { createdAt: 'ASC' }, // chronological order is critical
    });
  }

  private async emitReplayedEvent(
    event: AuditLog,
    sessionId: string,
    throttleMs = DEFAULT_THROTTLE_MS,
  ): Promise<void> {
    const payload = {
      ...event,
      metadata: event.metadata ? this.redactSensitiveFields(event.metadata) : undefined,
      // Mark as replayed so handlers can distinguish from live events
      __replay: true,
      __replaySessionId: sessionId,
    };

    this.eventEmitter.emit(REPLAY_EVENT, payload);

    if (throttleMs > 0) {
      await this.sleep(throttleMs);
    }
  }

  private validateOptions(options: ReplayOptions): void {
    if (!options.from || !options.to) {
      throw new BadRequestException('Replay requires both `from` and `to` dates');
    }

    if (options.from >= options.to) {
      throw new BadRequestException('`from` must be before `to`');
    }

    const windowDays =
      (options.to.getTime() - options.from.getTime()) / (1000 * 60 * 60 * 24);

    if (windowDays > MAX_REPLAY_WINDOW_DAYS) {
      throw new BadRequestException(
        `Replay window cannot exceed ${MAX_REPLAY_WINDOW_DAYS} days. ` +
          `Requested: ${Math.ceil(windowDays)} days`,
      );
    }
  }

  private redactSensitiveFields(
    metadata: Record<string, any>,
    depth = 0,
  ): Record<string, any> {
    if (depth > 5) return {};
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (SENSITIVE_FIELDS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactSensitiveFields(value, depth + 1);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
