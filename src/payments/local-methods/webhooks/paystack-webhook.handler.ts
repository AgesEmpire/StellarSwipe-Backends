import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocalPayment } from '../entities/local-payment.entity';
import { LocalPaymentStatus } from '../providers/base-local.provider';
import { PaystackProvider } from '../providers/paystack.provider';

@Injectable()
export class PaystackWebhookHandler {
  private readonly logger = new Logger(PaystackWebhookHandler.name);

  constructor(
    @InjectRepository(LocalPayment)
    private readonly paymentRepo: Repository<LocalPayment>,
    private readonly paystackProvider: PaystackProvider,
  ) {}

  async handle(payload: Record<string, any>, signature: string): Promise<void> {
    await this.paystackProvider.processWebhook(payload, signature);

    const { event, data } = payload;
    if (!data?.reference) return;

    const payment = await this.paymentRepo.findOne({
      where: { externalRef: data.reference, provider: 'paystack' },
    });

    if (!payment) {
      this.logger.warn(`No local payment found for Paystack reference: ${data.reference}`);
      return;
    }

    if (event === 'charge.success') {
      payment.status = LocalPaymentStatus.COMPLETED;
      payment.completedAt = new Date();
      payment.metadata = { ...payment.metadata, paystackTransactionId: data.id, channel: data.channel };
    } else if (event === 'charge.failed') {
      payment.status = LocalPaymentStatus.FAILED;
      payment.metadata = { ...payment.metadata, failureReason: data.gateway_response };
    }

    await this.paymentRepo.save(payment);
    this.logger.log(`Paystack payment ${payment.id} updated to ${payment.status}`);
  }
}
