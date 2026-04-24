import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocalPayment } from '../entities/local-payment.entity';
import { LocalPaymentStatus } from '../providers/base-local.provider';
import { MpesaProvider } from '../providers/mpesa.provider';

@Injectable()
export class MpesaWebhookHandler {
  private readonly logger = new Logger(MpesaWebhookHandler.name);

  constructor(
    @InjectRepository(LocalPayment)
    private readonly paymentRepo: Repository<LocalPayment>,
    private readonly mpesaProvider: MpesaProvider,
  ) {}

  async handle(payload: Record<string, any>, signature: string): Promise<void> {
    await this.mpesaProvider.processWebhook(payload, signature);

    const stkCallback = payload?.Body?.stkCallback;
    if (!stkCallback) return;

    const { ResultCode, CheckoutRequestID, CallbackMetadata } = stkCallback;

    const payment = await this.paymentRepo.findOne({
      where: { externalRef: CheckoutRequestID, provider: 'mpesa' },
    });

    if (!payment) {
      this.logger.warn(`No local payment found for M-Pesa CheckoutRequestID: ${CheckoutRequestID}`);
      return;
    }

    if (ResultCode === 0) {
      const items: any[] = CallbackMetadata?.Item ?? [];
      const mpesaReceiptNumber = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;

      payment.status = LocalPaymentStatus.COMPLETED;
      payment.completedAt = new Date();
      payment.metadata = { ...payment.metadata, mpesaReceiptNumber };
    } else {
      payment.status = LocalPaymentStatus.FAILED;
      payment.metadata = { ...payment.metadata, resultCode: ResultCode, resultDesc: stkCallback.ResultDesc };
    }

    await this.paymentRepo.save(payment);
    this.logger.log(`M-Pesa payment ${payment.id} updated to ${payment.status}`);
  }
}
