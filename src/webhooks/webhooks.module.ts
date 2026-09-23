import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsModule } from '../notifications/notifications.module';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookDeadLetter } from './entities/webhook-dead-letter.entity';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';
import { WebhookEventListener } from './listeners/webhook-event.listener';
import { StellarCallbackReconciliationJob } from './jobs/stellar-callback-reconciliation.job';
import { AuditWebhookSecretsJob } from './jobs/audit-webhook-secrets.job';
import { WebhookDeliveryProcessor } from './jobs/webhook-delivery.processor';
import { WebhookDeadLetterService } from './services/webhook-dead-letter.service';
import { WEBHOOK_DELIVERY_QUEUE, WEBHOOK_DEAD_LETTER_QUEUE } from './jobs/webhook-delivery.constants';
import { DistributedLockService } from '../common/services/distributed-lock.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook, WebhookDelivery, WebhookDeadLetter]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: WEBHOOK_DELIVERY_QUEUE },
      { name: WEBHOOK_DEAD_LETTER_QUEUE },
    ),
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
    WebhookDeadLetterService,
    DistributedLockService,
  ],
  exports: [WebhooksService, WebhookDeadLetterService],
})
export class WebhooksModule {}
