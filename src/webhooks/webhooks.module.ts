
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';
import { WebhookEventListener } from './listeners/webhook-event.listener';
import { StellarCallbackReconciliationJob } from './jobs/stellar-callback-reconciliation.job';
import { AuditWebhookSecretsJob } from './jobs/audit-webhook-secrets.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook, WebhookDelivery]),
    ScheduleModule.forRoot(),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    SignatureGeneratorService,
    WebhookSenderService,
    WebhookEventListener,
    StellarCallbackReconciliationJob,
    AuditWebhookSecretsJob,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
