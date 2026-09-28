export enum LocalPaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface LocalPaymentRequest {
  userId: string;
  amount: number;
  currency: string;
  phoneNumber?: string;
  accountNumber?: string;
  metadata?: Record<string, any>;
}

export interface LocalPaymentResponse {
  transactionId: string;
  externalRef: string;
  status: LocalPaymentStatus;
  amount: number;
  currency: string;
  checkoutUrl?: string;
  metadata?: Record<string, any>;
}

export interface LocalPaymentStatusResponse {
  transactionId: string;
  status: LocalPaymentStatus;
  amount: number;
  currency: string;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

export abstract class BaseLocalProvider {
  abstract readonly providerName: string;
  abstract readonly supportedCurrencies: string[];
  abstract readonly supportedCountries: string[];

  abstract initiatePayment(request: LocalPaymentRequest): Promise<LocalPaymentResponse>;
  abstract getPaymentStatus(transactionId: string): Promise<LocalPaymentStatusResponse>;
  abstract processWebhook(payload: Record<string, any>, signature: string): Promise<void>;

  supports(currency: string, country: string): boolean {
    return (
      this.supportedCurrencies.includes(currency.toUpperCase()) &&
      this.supportedCountries.includes(country.toUpperCase())
    );
  }
}
