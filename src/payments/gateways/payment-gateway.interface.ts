export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REFUNDED = 'refunded',
}

export enum PaymentMethod {
  CARD = 'card',
  BANK_TRANSFER = 'bank_transfer',
  CRYPTO = 'crypto',
  WALLET = 'wallet',
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  metadata?: Record<string, any>;
  clientSecret?: string;
  createdAt: Date;
}

export interface PaymentResult {
  success: boolean;
  paymentId: string;
  status: PaymentStatus;
  message?: string;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  amount: number;
  currency: string;
  message?: string;
}

export interface IPaymentGateway {
  createPayment(
    amount: number,
    currency: string,
    metadata?: Record<string, any>,
  ): Promise<PaymentIntent>;

  confirmPayment(paymentId: string): Promise<PaymentResult>;

  retrievePayment(paymentId: string): Promise<PaymentIntent>;

  refundPayment(paymentId: string, amount?: number): Promise<RefundResult>;

  handleWebhook(signature: string, payload: any): Promise<any>;

  listPaymentMethods(customerId: string): Promise<any[]>;
}
