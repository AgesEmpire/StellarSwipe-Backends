import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsModule } from '../notifications/notifications.module';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';
import { WebhookEventListener } from './listeners/webhook-event.listener';
import { StellarCallbackReconciliationJob } from './jobs/stellar-callback-reconciliation.job';
import { AuditWebhookSecretsJob } from './jobs/audit-webhook-secrets.job';
import { WebhookDeliveryProcessor } from './jobs/webhook-delivery.processor';
import { WEBHOOK_DELIVERY_QUEUE } from './jobs/webhook-delivery.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook, WebhookDelivery]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
    NotificationsModule,
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    SignatureGeneratorService,
    WebhookSenderService,
    WebhookEventListener,
    StellarCallbackReconciliationJob,
    AuditWebhookSecretsJob,
    WebhookDeliveryProcessor,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
