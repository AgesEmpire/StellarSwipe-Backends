import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';

export interface PaymentAuditContext {
  userId?: string;
  paymentId: string;
  amount?: number;
  currency?: string;
  gateway?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Standardizes audit event payloads for payment lifecycle actions and
 * persists them via the central AuditService.
 */
@Injectable()
export class PaymentAuditService {
  private readonly logger = new Logger(PaymentAuditService.name);

  constructor(private readonly auditService: AuditService) {}

  async logPaymentCreated(ctx: PaymentAuditContext): Promise<void> {
    await this.record(AuditAction.PAYMENT_CREATED, AuditStatus.SUCCESS, ctx);
  }

  async logPaymentConfirmed(ctx: PaymentAuditContext): Promise<void> {
    await this.record(AuditAction.PAYMENT_CONFIRMED, AuditStatus.SUCCESS, ctx);
  }

  async logPaymentFailed(ctx: PaymentAuditContext, errorMessage: string): Promise<void> {
    await this.record(AuditAction.PAYMENT_FAILED, AuditStatus.FAILURE, ctx, errorMessage);
  }

  async logPaymentRefunded(ctx: PaymentAuditContext): Promise<void> {
    await this.record(AuditAction.PAYMENT_REFUNDED, AuditStatus.SUCCESS, ctx);
  }

  private async record(
    action: AuditAction,
    status: AuditStatus,
    ctx: PaymentAuditContext,
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.auditService.log({
        userId: ctx.userId,
        action,
        resource: 'payment',
        resourceId: ctx.paymentId,
        status,
        errorMessage,
        metadata: {
          amount: ctx.amount,
          currency: ctx.currency,
          gateway: ctx.gateway,
          ...ctx.metadata,
        },
      });
    } catch (error) {
      // Audit logging must never break the payment flow.
      this.logger.error(
        `Failed to record payment audit event: ${action}`,
        (error as Error).message,
      );
    }
  }
}
