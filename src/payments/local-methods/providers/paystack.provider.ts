import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  BaseLocalProvider,
  LocalPaymentRequest,
  LocalPaymentResponse,
  LocalPaymentStatus,
  LocalPaymentStatusResponse,
} from './base-local.provider';

@Injectable()
export class PaystackProvider extends BaseLocalProvider {
  readonly providerName = 'paystack';
  readonly supportedCurrencies = ['NGN', 'GHS', 'ZAR', 'KES'];
  readonly supportedCountries = ['NG', 'GH', 'ZA', 'KE'];

  private readonly logger = new Logger(PaystackProvider.name);
  private readonly secretKey: string;
  private readonly callbackUrl: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.secretKey = configService.get('PAYSTACK_SECRET_KEY', '');
    this.callbackUrl = configService.get('PAYSTACK_CALLBACK_URL', '');
  }

  async initiatePayment(request: LocalPaymentRequest): Promise<LocalPaymentResponse> {
    this.logger.log(`Initiating Paystack payment for user ${request.userId}, amount=${request.amount} ${request.currency}`);

    const reference = `PS-${Date.now()}-${request.userId.slice(0, 8)}`;
    const amountKobo = Math.round(request.amount * 100);

    // Paystack Initialize Transaction API call would happen here
    // POST https://api.paystack.co/transaction/initialize

    return {
      transactionId: reference,
      externalRef: reference,
      status: LocalPaymentStatus.PENDING,
      amount: request.amount,
      currency: request.currency,
      checkoutUrl: `https://checkout.paystack.com/${reference}`,
      metadata: { reference, amountKobo },
    };
  }

  async getPaymentStatus(transactionId: string): Promise<LocalPaymentStatusResponse> {
    this.logger.log(`Verifying Paystack transaction ${transactionId}`);

    // GET https://api.paystack.co/transaction/verify/:reference

    return {
      transactionId,
      status: LocalPaymentStatus.PENDING,
      amount: 0,
      currency: 'NGN',
    };
  }

  async processWebhook(payload: Record<string, any>, signature: string): Promise<void> {
    const expectedHash = crypto
      .createHmac('sha512', this.secretKey)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (expectedHash !== signature) {
      this.logger.warn('Invalid Paystack webhook signature');
      return;
    }

    const event = payload.event;
    const data = payload.data;
    this.logger.log(`Paystack webhook event=${event}, reference=${data?.reference}`);
  }
}
