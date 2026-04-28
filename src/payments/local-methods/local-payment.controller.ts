import { Controller, Get, Post, Body, Param, Query, Headers } from '@nestjs/common';
import { LocalPaymentService } from './local-payment.service';
import { MpesaWebhookHandler } from './webhooks/mpesa-webhook.handler';
import { PaystackWebhookHandler } from './webhooks/paystack-webhook.handler';
import { MpesaPaymentDto } from './dto/mpesa-payment.dto';
import { PaystackPaymentDto } from './dto/paystack-payment.dto';

@Controller('payments/local')
export class LocalPaymentController {
  constructor(
    private readonly localPaymentService: LocalPaymentService,
    private readonly mpesaWebhook: MpesaWebhookHandler,
    private readonly paystackWebhook: PaystackWebhookHandler,
  ) {}

  @Get('providers')
  listAllProviders() {
    return this.localPaymentService.listAllProviders();
  }

  @Get('providers/:country')
  getProvidersForCountry(@Param('country') country: string) {
    return this.localPaymentService.getAvailableProviders(country);
  }

  @Post('mpesa/initiate')
  async initiateMpesa(@Body() dto: MpesaPaymentDto) {
    return this.localPaymentService.initiatePayment('KE', 'KES', {
      userId: dto.userId,
      amount: dto.amount,
      currency: 'KES',
      phoneNumber: dto.phoneNumber,
      metadata: dto.metadata,
    });
  }

  @Post('paystack/initiate')
  async initiatePaystack(@Body() dto: PaystackPaymentDto) {
    const country = dto.currency === 'NGN' ? 'NG' : dto.currency === 'GHS' ? 'GH' : 'NG';
    return this.localPaymentService.initiatePayment(country, dto.currency, {
      userId: dto.userId,
      amount: dto.amount,
      currency: dto.currency,
      metadata: { email: dto.email, ...dto.metadata },
    });
  }

  @Get(':paymentId/status')
  async getStatus(@Param('paymentId') paymentId: string) {
    return this.localPaymentService.getPaymentStatus(paymentId);
  }

  @Get('user/:userId')
  async getUserPayments(@Param('userId') userId: string) {
    return this.localPaymentService.getUserPayments(userId);
  }

  @Post('webhooks/mpesa')
  async mpesaWebhook(@Body() payload: Record<string, any>) {
    await this.mpesaWebhook.handle(payload, '');
    return { received: true };
  }

  @Post('webhooks/paystack')
  async paystackWebhook(
    @Body() payload: Record<string, any>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    await this.paystackWebhook.handle(payload, signature);
    return { received: true };
  }
}
