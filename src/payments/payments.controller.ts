import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  RawBodyRequest,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Request } from 'express';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly gatewayFactory: PaymentGatewayFactory) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async createPayment(@Body() dto: CreatePaymentDto) {
    const gateway = dto.gateway
      ? this.gatewayFactory.getGateway(dto.gateway)
      : this.gatewayFactory.getDefaultGateway();

    const payment = await gateway.createPayment(
      dto.amount,
      dto.currency,
      dto.metadata,
    );

    return {
      success: true,
      payment,
    };
  }

  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmPayment(@Param('id') paymentId: string) {
    const gateway = this.gatewayFactory.getDefaultGateway();
    const result = await gateway.confirmPayment(paymentId);

    return result;
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getPayment(@Param('id') paymentId: string) {
    const gateway = this.gatewayFactory.getDefaultGateway();
    const payment = await gateway.retrievePayment(paymentId);

    return {
      success: true,
      payment,
    };
  }

  @Post(':id/refund')
  @UseGuards(JwtAuthGuard)
  async refundPayment(
    @Param('id') paymentId: string,
    @Body('amount') amount?: number,
  ) {
    const gateway = this.gatewayFactory.getDefaultGateway();
    const result = await gateway.refundPayment(paymentId, amount);

    return result;
  }

  @Post('webhooks/stripe')
  async handleStripeWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const gateway = this.gatewayFactory.getDefaultGateway();

    try {
      const event = await gateway.handleWebhook(signature, req.rawBody);
      return { received: true, event: event.type };
    } catch (error) {
      this.logger.error(`Webhook error: ${error.message}`);
      throw error;
    }
  }
}
