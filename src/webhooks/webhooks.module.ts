import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';
import { WebhookEventListener } from './listeners/webhook-event.listener';

@Module({
  imports: [TypeOrmModule.forFeature([Webhook, WebhookDelivery])],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    SignatureGeneratorService,
    WebhookSenderService,
    WebhookEventListener,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
