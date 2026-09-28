import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessedWebhookEvent } from './entities/processed-webhook-event.entity';
import { WebhookIdempotencyService } from './services/webhook-idempotency.service';

/**
 * Import into any module whose controllers/services handle inbound
 * third-party webhook callbacks and need duplicate-delivery protection.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ProcessedWebhookEvent])],
  providers: [WebhookIdempotencyService],
  exports: [WebhookIdempotencyService],
})
export class WebhookIdempotencyModule {}
