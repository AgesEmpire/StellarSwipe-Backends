import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsModule } from '../notifications/notifications.module';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookDeadLetter } from './entities/webhook-dead-letter.entity';
import { WebhookReplayAudit } from './entities/webhook-replay-audit.entity';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';
import { WebhookDeliveryMetricsService } from './services/webhook-delivery-metrics.service';
import { WebhookEventListener } from './listeners/webhook-event.listener';
import { ProcessedWebhookEvent } from './inbound/processed-webhook-event.entity';
import { WebhookReplayGuardService } from './inbound/webhook-replay-guard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Webhook, WebhookDelivery, ProcessedWebhookEvent])],
import { StellarCallbackReconciliationJob } from './jobs/stellar-callback-reconciliation.job';
import { AuditWebhookSecretsJob } from './jobs/audit-webhook-secrets.job';
import { WebhookDeliveryProcessor } from './jobs/webhook-delivery.processor';
import { WebhookDeadLetterService } from './services/webhook-dead-letter.service';
import { WEBHOOK_DELIVERY_QUEUE, WEBHOOK_DEAD_LETTER_QUEUE } from './jobs/webhook-delivery.constants';
import { DistributedLockService } from '../common/services/distributed-lock.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Webhook,
      WebhookDelivery,
      WebhookDeadLetter,
      WebhookReplayAudit,
    ]),
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
    WebhookReplayGuardService,
  ],
  exports: [WebhooksService, WebhookReplayGuardService],
    StellarCallbackReconciliationJob,
    AuditWebhookSecretsJob,
    WebhookDeliveryProcessor,
    WebhookDeliveryMetricsService,
    WebhookDeadLetterService,
    DistributedLockService,
  ],
  exports: [WebhooksService, WebhookDeadLetterService],
})
export class WebhooksModule {}
