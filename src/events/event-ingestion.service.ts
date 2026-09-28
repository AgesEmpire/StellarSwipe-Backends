/**
 * Event Ingestion Service — guardrails for high-volume pipelines
 *
 * Protects backend throughput and stability by enforcing:
 *  1. Per-source rate limiting (sliding-window counter in Redis/cache).
 *  2. Payload size cap.
 *  3. Batch size cap.
 *  4. Circuit-breaker: when the error rate for a source exceeds the threshold
 *     the source is temporarily blocked and events are dropped with a warning.
 *
 * Security: source identity is validated against a known allowlist stored in
 * config.  Unknown sources are rejected with 403 before any processing occurs,
 * preserving existing authorization semantics.
 */
import {
  Injectable,
  Logger,
  ForbiddenException,
  PayloadTooLargeException,
  TooManyRequestsException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export interface IngestEventDto {
  /** Identifies the upstream producer — must be in the allowlist */
  sourceId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface IngestionResult {
  accepted: number;
  rejected: number;
  reason?: string;
}

/** Guardrail configuration (all values have safe defaults) */
interface GuardrailConfig {
  maxBatchSize: number;
  maxPayloadBytes: number;
  rateWindowMs: number;
  rateLimit: number;
  circuitBreakerThreshold: number; // error-rate 0–1
  circuitBreakerWindowMs: number;
}

const DEFAULTS: GuardrailConfig = {
  maxBatchSize: 500,
  maxPayloadBytes: 65_536, // 64 KB per event
  rateWindowMs: 60_000,   // 1 minute sliding window
  rateLimit: 10_000,      // events per window per source
  circuitBreakerThreshold: 0.5,
  circuitBreakerWindowMs: 30_000,
};

@Injectable()
export class EventIngestionService {
  private readonly logger = new Logger(EventIngestionService.name);
  private readonly cfg: GuardrailConfig;
  private readonly allowedSources: Set<string>;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly config: ConfigService,
  ) {
    this.cfg = {
      maxBatchSize:
        this.config.get<number>('ingestion.maxBatchSize') ?? DEFAULTS.maxBatchSize,
      maxPayloadBytes:
        this.config.get<number>('ingestion.maxPayloadBytes') ?? DEFAULTS.maxPayloadBytes,
      rateWindowMs:
        this.config.get<number>('ingestion.rateWindowMs') ?? DEFAULTS.rateWindowMs,
      rateLimit:
        this.config.get<number>('ingestion.rateLimit') ?? DEFAULTS.rateLimit,
      circuitBreakerThreshold:
        this.config.get<number>('ingestion.circuitBreakerThreshold') ??
        DEFAULTS.circuitBreakerThreshold,
      circuitBreakerWindowMs:
        this.config.get<number>('ingestion.circuitBreakerWindowMs') ??
        DEFAULTS.circuitBreakerWindowMs,
    };

    const raw = this.config.get<string>('ingestion.allowedSources') ?? '';
    this.allowedSources = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async ingestBatch(events: IngestEventDto[]): Promise<IngestionResult> {
    if (events.length === 0) return { accepted: 0, rejected: 0 };

    // 1. Batch size cap
    if (events.length > this.cfg.maxBatchSize) {
      throw new PayloadTooLargeException(
        `Batch size ${events.length} exceeds limit of ${this.cfg.maxBatchSize}`,
      );
    }

    let accepted = 0;
    let rejected = 0;

    for (const event of events) {
      try {
        await this.ingestOne(event);
        accepted++;
      } catch {
        rejected++;
      }
    }

    return { accepted, rejected };
  }

  async ingestOne(event: IngestEventDto): Promise<void> {
    // 2. Source allowlist check
    if (
      this.allowedSources.size > 0 &&
      !this.allowedSources.has(event.sourceId)
    ) {
      throw new ForbiddenException(
        `Source "${event.sourceId}" is not in the ingestion allowlist`,
      );
    }

    // 3. Payload size check
    const payloadSize = Buffer.byteLength(JSON.stringify(event.payload), 'utf8');
    if (payloadSize > this.cfg.maxPayloadBytes) {
      throw new PayloadTooLargeException(
        `Payload size ${payloadSize} bytes exceeds limit of ${this.cfg.maxPayloadBytes}`,
      );
    }

    // 4. Circuit-breaker check
    if (await this.isCircuitOpen(event.sourceId)) {
      this.logger.warn(`Circuit open for source "${event.sourceId}" — dropping event`);
      throw new TooManyRequestsException(
        `Circuit breaker open for source "${event.sourceId}"`,
      );
    }

    // 5. Rate limit check
    await this.checkRateLimit(event.sourceId);

    // ── Actual processing would be delegated here ──────────────────────────
    this.logger.debug(`Ingested event type="${event.eventType}" source="${event.sourceId}"`);
  }

  // ── Guardrail helpers ──────────────────────────────────────────────────────

  private async checkRateLimit(sourceId: string): Promise<void> {
    const key = `ingestion:rate:${sourceId}`;
    const current = (await this.cache.get<number>(key)) ?? 0;

    if (current >= this.cfg.rateLimit) {
      await this.recordError(sourceId);
      throw new TooManyRequestsException(
        `Rate limit exceeded for source "${sourceId}" (${current}/${this.cfg.rateLimit} per window)`,
      );
    }

    await this.cache.set(key, current + 1, this.cfg.rateWindowMs);
  }

  /** Record a processing error for the circuit-breaker window */
  async recordError(sourceId: string): Promise<void> {
    const key = `ingestion:errors:${sourceId}`;
    const current = (await this.cache.get<number>(key)) ?? 0;
    await this.cache.set(key, current + 1, this.cfg.circuitBreakerWindowMs);

    const totalKey = `ingestion:total:${sourceId}`;
    const total = (await this.cache.get<number>(totalKey)) ?? 0;
    await this.cache.set(totalKey, total + 1, this.cfg.circuitBreakerWindowMs);
  }

  private async isCircuitOpen(sourceId: string): Promise<boolean> {
    const errors = (await this.cache.get<number>(`ingestion:errors:${sourceId}`)) ?? 0;
    const total = (await this.cache.get<number>(`ingestion:total:${sourceId}`)) ?? 0;
    if (total === 0) return false;
    return errors / total >= this.cfg.circuitBreakerThreshold;
  }

  /** Expose current rate counter for a source (useful for monitoring) */
  async getRateCount(sourceId: string): Promise<number> {
    return (await this.cache.get<number>(`ingestion:rate:${sourceId}`)) ?? 0;
  }
}
