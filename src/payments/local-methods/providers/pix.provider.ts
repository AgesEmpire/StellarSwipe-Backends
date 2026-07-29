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
export class PixProvider extends BaseLocalProvider {
  readonly providerName = 'pix';
  readonly supportedCurrencies = ['BRL'];
  readonly supportedCountries = ['BR'];

  private readonly logger = new Logger(PixProvider.name);
  private readonly pixKey: string;
  private readonly merchantName: string;
  private readonly merchantCity: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.pixKey = configService.get('PIX_KEY', '');
    this.merchantName = configService.get('PIX_MERCHANT_NAME', 'StellarSwipe');
    this.merchantCity = configService.get('PIX_MERCHANT_CITY', 'SAO PAULO');
  }

  async initiatePayment(request: LocalPaymentRequest): Promise<LocalPaymentResponse> {
    this.logger.log(`Initiating PIX payment for user ${request.userId}, amount=R$${request.amount}`);

    const txId = `SS${Date.now()}${request.userId.replace(/-/g, '').slice(0, 8)}`.toUpperCase();

    // In production this would call the PSP's API to generate a PIX QR code
    // e.g. Gerencianet, PagSeguro, or direct BACEN API

    return {
      transactionId: txId,
      externalRef: txId,
      status: LocalPaymentStatus.PENDING,
      amount: request.amount,
      currency: request.currency,
      metadata: {
        txId,
        pixKey: this.pixKey,
        merchantName: this.merchantName,
        merchantCity: this.merchantCity,
        qrCodePayload: this.buildPixPayload(txId, request.amount),
      },
    };
  }

  async getPaymentStatus(transactionId: string): Promise<LocalPaymentStatusResponse> {
    this.logger.log(`Checking PIX status for txId ${transactionId}`);
    return {
      transactionId,
      status: LocalPaymentStatus.PENDING,
      amount: 0,
      currency: 'BRL',
    };
  }

  async processWebhook(payload: Record<string, any>, _signature: string): Promise<void> {
    const pixNotifications = payload?.pix ?? [];
    for (const pix of pixNotifications) {
      this.logger.log(`PIX received: txid=${pix.txid}, amount=R$${pix.valor}, endToEndId=${pix.endToEndId}`);
    }
  }

  private buildPixPayload(txId: string, amount: number): string {
    const amountStr = amount.toFixed(2);
    return `PIX:${this.pixKey}:${amountStr}:${txId}:${this.merchantName}`;
  }
}
