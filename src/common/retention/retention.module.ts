import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RetentionService } from './retention.service';
import { resolveRetentionDays } from './retention.config';
import { OutboxEvent, OutboxEventStatus } from '../../events/outbox/outbox-event.entity';
import { WebhookDelivery } from '../../webhooks/entities/webhook-delivery.entity';
import { NotificationDeliveryAuditLog } from '../../notifications/entities/notification-delivery-audit-log.entity';

/**
 * Registers the built-in retention policies for record types that don't
 * already own a bespoke cleanup routine:
 *
 * - Integration events (outbox): only *published* events are pruned — pending
 *   or failed events stay until they're resolved, regardless of age.
 * - Webhook delivery attempts and notification delivery logs: operational
 *   logs pruned purely on age.
 *
 * The audit trail keeps its existing dedicated cleanup in AuditService
 * (now reading its window from the same env-configurable defaults — see
 * `resolveRetentionDays('auditLogDays')`), since it also needs to bypass a
 * BeforeRemove hook that these generic policies don't need to know about.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule implements OnModuleInit {
  constructor(private readonly retentionService: RetentionService) {}

  onModuleInit(): void {
    this.retentionService.registerPolicy({
      name: 'integration-events',
      entity: OutboxEvent,
      dateProperty: 'createdAt',
      retentionDays: resolveRetentionDays('integrationEventDays'),
      extraWhere: 'record.status = :status',
      extraParams: { status: OutboxEventStatus.PUBLISHED },
    });

    this.retentionService.registerPolicy({
      name: 'webhook-deliveries',
      entity: WebhookDelivery,
      dateProperty: 'createdAt',
      retentionDays: resolveRetentionDays('webhookDeliveryDays'),
    });

    this.retentionService.registerPolicy({
      name: 'notification-delivery-logs',
      entity: NotificationDeliveryAuditLog,
      dateProperty: 'createdAt',
      retentionDays: resolveRetentionDays('notificationDeliveryLogDays'),
    });
  }
}
