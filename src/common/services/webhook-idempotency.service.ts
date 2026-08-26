import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProcessedWebhookEvent } from '../entities/processed-webhook-event.entity';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Matches the `eventId` column width — anything longer is rejected up front. */
const MAX_EVENT_ID_LENGTH = 255;

/**
 * Deduplicates external webhook deliveries so retried/duplicate callbacks
 * (from Stripe, M-Pesa, Paystack, etc.) don't trigger duplicate side effects.
 *
 * Usage:
 *   const isFirstDelivery = await this.idempotency.markProcessed('stripe', event.id);
 *   if (!isFirstDelivery) return; // already handled, safe to no-op / ack
 */
@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(
    @InjectRepository(ProcessedWebhookEvent)
    private readonly repo: Repository<ProcessedWebhookEvent>,
  ) {}

  /**
   * Atomically records (provider, eventId) as processed.
   * Returns true the first time it's seen, false on any repeat delivery.
   *
   * Throws BadRequestException for malformed identifiers (missing, blank,
   * non-string, or implausibly long) instead of silently inserting garbage
   * that would defeat the (provider, eventId) uniqueness guarantee.
   */
  async markProcessed(provider: string, eventId: string): Promise<boolean> {
    this.assertValidEventId(provider, eventId);

    try {
      await this.repo.insert({ provider, eventId: eventId.trim() });
      return true;
    } catch (error: any) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn(`Duplicate webhook delivery ignored: ${provider}/${eventId}`);
        return false;
      }
      throw error;
    }
  }

  /**
   * Read-only replay check — does not record anything. Useful when a caller
   * needs to know whether an event was already handled without racing to be
   * the one that records it (e.g. pre-flight checks, admin tooling).
   */
  async wasProcessed(provider: string, eventId: string): Promise<boolean> {
    this.assertValidEventId(provider, eventId);
    const existing = await this.repo.findOne({
      where: { provider, eventId: eventId.trim() },
    });
    return existing !== null;
  }

  private assertValidEventId(provider: string, eventId: unknown): asserts eventId is string {
    if (typeof eventId !== 'string') {
      throw new BadRequestException(
        `Malformed webhook event identifier for provider "${provider}": expected a string`,
      );
    }

    const trimmed = eventId.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(
        `Malformed webhook event identifier for provider "${provider}": identifier is empty`,
      );
    }

    if (trimmed.length > MAX_EVENT_ID_LENGTH) {
      throw new BadRequestException(
        `Malformed webhook event identifier for provider "${provider}": exceeds ${MAX_EVENT_ID_LENGTH} characters`,
      );
    }
  }

  private isUniqueViolation(error: any): boolean {
    return error?.code === POSTGRES_UNIQUE_VIOLATION;
  }
}
