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
export class UpiProvider extends BaseLocalProvider {
  readonly providerName = 'upi';
  readonly supportedCurrencies = ['INR'];
  readonly supportedCountries = ['IN'];

  private readonly logger = new Logger(UpiProvider.name);
  private readonly vpa: string;
  private readonly merchantName: string;
  private readonly razorpayKeyId: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.vpa = configService.get('UPI_VPA', '');
    this.merchantName = configService.get('UPI_MERCHANT_NAME', 'StellarSwipe');
    this.razorpayKeyId = configService.get('RAZORPAY_KEY_ID', '');
  }

  async initiatePayment(request: LocalPaymentRequest): Promise<LocalPaymentResponse> {
    this.logger.log(`Initiating UPI payment for user ${request.userId}, amount=₹${request.amount}`);

    const orderId = `SS_UPI_${Date.now()}_${request.userId.slice(0, 8)}`;
    const amountPaise = Math.round(request.amount * 100);

    // In production this would use Razorpay/PhonePe/Paytm API to create a UPI payment link

    const upiDeepLink = `upi://pay?pa=${encodeURIComponent(this.vpa)}&pn=${encodeURIComponent(this.merchantName)}&am=${request.amount}&cu=INR&tn=${orderId}`;

    return {
      transactionId: orderId,
      externalRef: orderId,
      status: LocalPaymentStatus.PENDING,
      amount: request.amount,
      currency: request.currency,
      checkoutUrl: upiDeepLink,
      metadata: { orderId, amountPaise, vpa: this.vpa, upiDeepLink },
    };
  }

  async getPaymentStatus(transactionId: string): Promise<LocalPaymentStatusResponse> {
    this.logger.log(`Checking UPI status for order ${transactionId}`);
    return {
      transactionId,
      status: LocalPaymentStatus.PENDING,
      amount: 0,
      currency: 'INR',
    };
  }

  async processWebhook(payload: Record<string, any>, signature: string): Promise<void> {
    this.logger.log(`Processing UPI webhook: event=${payload?.event}, orderId=${payload?.payload?.payment?.entity?.order_id}`);
  }
}
