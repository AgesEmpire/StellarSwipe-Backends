/**
 * Payment Provider Interface
 * Defines the contract for all payment providers (Stripe, PayPal, etc.)
 */

export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export enum PaymentMethod {
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  PAYPAL = 'paypal',
  BANK_TRANSFER = 'bank_transfer',
  CRYPTO = 'crypto',
}

export interface CreatePaymentRequest {
  userId: string;
  amount: number;
  currency: string;
  description: string;
  paymentMethod: PaymentMethod;
  metadata?: Record<string, any>;
  returnUrl?: string;
  notificationUrl?: string;
}

export interface PaymentResponse {
  paymentId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  transactionId?: string;
  redirectUrl?: string;
  clientSecret?: string;
  metadata?: Record<string, any>;
}

export interface RefundRequest {
  paymentId: string;
  amount?: number; // If not provided, refund full amount
  reason?: string;
  metadata?: Record<string, any>;
}

export interface RefundResponse {
  refundId: string;
  paymentId: string;
  amount: number;
  status: PaymentStatus;
  timestamp: Date;
}

export interface PaymentProviderConfig {
  apiKey: string;
  apiSecret?: string;
  webhookSecret?: string;
  mode: 'test' | 'live';
  [key: string]: any;
}

export interface PaymentProvider {
  /**
   * Create a new payment
   */
  createPayment(request: CreatePaymentRequest): Promise<PaymentResponse>;

  /**
   * Retrieve payment details
   */
  getPayment(paymentId: string): Promise<PaymentResponse>;

  /**
   * Refund a payment
   */
  refundPayment(request: RefundRequest): Promise<RefundResponse>;

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(payload: string, signature: string): boolean;

  /**
   * Handle webhook event
   */
  handleWebhookEvent(event: Record<string, any>): Promise<void>;

  /**
   * List payment methods for user
   */
  listPaymentMethods(userId: string): Promise<any[]>;

  /**
   * Delete a payment method
   */
  deletePaymentMethod(paymentMethodId: string): Promise<void>;

  /**
   * Save a payment method for future use
   */
  savePaymentMethod(userId: string, paymentMethodData: any): Promise<string>;

  /**
   * Check if provider is available
   */
  isAvailable(): boolean;

  /**
   * Get provider name
   */
  getProviderName(): string;
}
