import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Stripe types (install with: npm install stripe)
interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  client_secret?: string;
}

interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

@Injectable()
export class StripePaymentService {
  private readonly logger = new Logger(StripePaymentService.name);
  private stripe: any; // Will be Stripe instance when stripe package is installed
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('stripe.apiKey');
    
    // Initialize Stripe when package is available
    try {
      // const Stripe = require('stripe');
      // this.stripe = new Stripe(this.apiKey, {
      //   apiVersion: '2023-10-16',
      // });
      this.logger.log('Stripe payment service initialized (mock mode - install stripe package)');
    } catch (error) {
      this.logger.warn('Stripe package not installed. Install with: npm install stripe');
    }
  }

  async createPaymentIntent(
    amount: number,
    currency: string,
    metadata?: Record<string, any>,
  ): Promise<StripePaymentIntent> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe not configured. Install stripe package.');
    }

    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      });

      this.logger.log(`Payment intent created: ${paymentIntent.id}`);
      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to create payment intent: ${error.message}`);
      throw new BadRequestException(`Payment creation failed: ${error.message}`);
    }
  }

  async confirmPayment(paymentIntentId: string): Promise<StripePaymentIntent> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe not configured');
    }

    try {
      const paymentIntent = await this.stripe.paymentIntents.confirm(
        paymentIntentId,
      );

      this.logger.log(`Payment confirmed: ${paymentIntent.id}`);
      return paymentIntent;
    } catch (error) {
      this.logger.error(`Failed to confirm payment: ${error.message}`);
      throw new BadRequestException(`Payment confirmation failed: ${error.message}`);
    }
  }

  async retrievePayment(paymentIntentId: string): Promise<StripePaymentIntent> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe not configured');
    }

    try {
      return await this.stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      this.logger.error(`Failed to retrieve payment: ${error.message}`);
      throw new BadRequestException(`Payment retrieval failed: ${error.message}`);
    }
  }

  async refundPayment(
    paymentIntentId: string,
    amount?: number,
  ): Promise<any> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe not configured');
    }

    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: amount ? Math.round(amount * 100) : undefined,
      });

      this.logger.log(`Refund created: ${refund.id}`);
      return refund;
    } catch (error) {
      this.logger.error(`Failed to create refund: ${error.message}`);
      throw new BadRequestException(`Refund failed: ${error.message}`);
    }
  }

  async handleWebhook(signature: string, payload: any): Promise<any> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe not configured');
    }

    const webhookSecret = this.configService.get<string>('stripe.webhookSecret');

    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret,
      );

      this.logger.log(`Webhook received: ${event.type}`);

      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(event.data.object);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailure(event.data.object);
          break;
        case 'charge.refunded':
          await this.handleRefund(event.data.object);
          break;
        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      return event;
    } catch (error) {
      this.logger.error(`Webhook error: ${error.message}`);
      throw new BadRequestException(`Webhook validation failed: ${error.message}`);
    }
  }

  private async handlePaymentSuccess(paymentIntent: StripePaymentIntent): Promise<void> {
    this.logger.log(`Payment succeeded: ${paymentIntent.id}`);
    // Implement business logic for successful payment
  }

  private async handlePaymentFailure(paymentIntent: StripePaymentIntent): Promise<void> {
    this.logger.warn(`Payment failed: ${paymentIntent.id}`);
    // Implement business logic for failed payment
  }

  private async handleRefund(charge: StripeCharge): Promise<void> {
    this.logger.log(`Refund processed: ${charge.id}`);
    // Implement business logic for refund
  }

  async listPaymentMethods(customerId: string): Promise<any[]> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe not configured');
    }

    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      return paymentMethods.data;
    } catch (error) {
      this.logger.error(`Failed to list payment methods: ${error.message}`);
      throw new BadRequestException(`Failed to retrieve payment methods`);
    }
  }

  async createCustomer(
    email: string,
    metadata?: Record<string, any>,
  ): Promise<any> {
    if (!this.stripe) {
      throw new BadRequestException('Stripe not configured');
    }

    try {
      const customer = await this.stripe.customers.create({
        email,
        metadata,
      });

      this.logger.log(`Customer created: ${customer.id}`);
      return customer;
    } catch (error) {
      this.logger.error(`Failed to create customer: ${error.message}`);
      throw new BadRequestException(`Customer creation failed: ${error.message}`);
    }
  }
}
