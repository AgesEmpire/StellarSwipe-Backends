import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BaseLocalProvider,
  LocalPaymentRequest,
  LocalPaymentResponse,
  LocalPaymentStatus,
  LocalPaymentStatusResponse,
} from './base-local.provider';

@Injectable()
export class MpesaProvider extends BaseLocalProvider {
  readonly providerName = 'mpesa';
  readonly supportedCurrencies = ['KES'];
  readonly supportedCountries = ['KE'];

  private readonly logger = new Logger(MpesaProvider.name);
  private readonly shortCode: string;
  private readonly passKey: string;
  private readonly callbackUrl: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.shortCode = configService.get('MPESA_SHORT_CODE', '');
    this.passKey = configService.get('MPESA_PASS_KEY', '');
    this.callbackUrl = configService.get('MPESA_CALLBACK_URL', '');
  }

  async initiatePayment(request: LocalPaymentRequest): Promise<LocalPaymentResponse> {
    this.logger.log(`Initiating M-Pesa STK push to ${request.phoneNumber} for ${request.amount} ${request.currency}`);

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(`${this.shortCode}${this.passKey}${timestamp}`).toString('base64');
    const externalRef = `MP-${Date.now()}-${request.userId.slice(0, 8)}`;

    // M-Pesa STK Push API call would happen here
    // POST https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest

    return {
      transactionId: externalRef,
      externalRef,
      status: LocalPaymentStatus.PENDING,
      amount: request.amount,
      currency: request.currency,
      metadata: { timestamp, shortCode: this.shortCode },
    };
  }

  async getPaymentStatus(transactionId: string): Promise<LocalPaymentStatusResponse> {
    this.logger.log(`Checking M-Pesa status for ${transactionId}`);
    return {
      transactionId,
      status: LocalPaymentStatus.PENDING,
      amount: 0,
      currency: 'KES',
    };
  }

  async processWebhook(payload: Record<string, any>, signature: string): Promise<void> {
    this.logger.log(`Processing M-Pesa webhook: ${JSON.stringify(payload)}`);
    const stkCallback = payload?.Body?.stkCallback;
    if (!stkCallback) return;

    const resultCode = stkCallback.ResultCode;
    const checkoutRequestId = stkCallback.CheckoutRequestID;

    this.logger.log(`M-Pesa callback for ${checkoutRequestId}: ResultCode=${resultCode}`);
  }
}
