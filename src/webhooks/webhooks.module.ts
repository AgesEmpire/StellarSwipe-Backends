import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';
import { WebhookEventListener } from './listeners/webhook-event.listener';
import { ProcessedWebhookEvent } from './inbound/processed-webhook-event.entity';
import { WebhookReplayGuardService } from './inbound/webhook-replay-guard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Webhook, WebhookDelivery, ProcessedWebhookEvent])],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    SignatureGeneratorService,
    WebhookSenderService,
    WebhookEventListener,
    WebhookReplayGuardService,
  ],
  exports: [WebhooksService, WebhookReplayGuardService],
})
export class WebhooksModule {}
