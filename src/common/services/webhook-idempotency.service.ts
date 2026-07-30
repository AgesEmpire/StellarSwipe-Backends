import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProcessedWebhookEvent } from '../entities/processed-webhook-event.entity';

const POSTGRES_UNIQUE_VIOLATION = '23505';

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
   */
  async markProcessed(provider: string, eventId: string): Promise<boolean> {
    try {
      await this.repo.insert({ provider, eventId });
      return true;
    } catch (error: any) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn(`Duplicate webhook delivery ignored: ${provider}/${eventId}`);
        return false;
      }
      throw error;
    }
  }

  private isUniqueViolation(error: any): boolean {
    return error?.code === POSTGRES_UNIQUE_VIOLATION;
  }
}
