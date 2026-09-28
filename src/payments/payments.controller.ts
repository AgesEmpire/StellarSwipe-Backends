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
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentAuditService } from './payment-audit.service';
import { Request } from 'express';
import { FeatureFlagGuard } from '../feature-flags/guards/feature-flag.guard';
import { RequireFlag } from '../feature-flags/decorators/require-flag.decorator';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly paymentAuditService: PaymentAuditService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 30, window: 60 })
  async createPayment(@Body() dto: CreatePaymentDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    const gateway = dto.gateway
      ? this.gatewayFactory.getGateway(dto.gateway)
      : this.gatewayFactory.getDefaultGateway();

    try {
      const payment = await gateway.createPayment(
        dto.amount,
        dto.currency,
        dto.metadata,
      );

      await this.paymentAuditService.logPaymentCreated({
        userId,
        paymentId: payment.id,
        amount: dto.amount,
        currency: dto.currency,
        gateway: dto.gateway,
      });

      return {
        success: true,
        payment,
      };
    } catch (error) {
      await this.paymentAuditService.logPaymentFailed(
        { userId, paymentId: 'unknown', amount: dto.amount, currency: dto.currency, gateway: dto.gateway },
        (error as Error).message,
      );
      throw error;
    }
  }

  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard)
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 30, window: 60 })
  async confirmPayment(@Param('id') paymentId: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    const gateway = this.gatewayFactory.getDefaultGateway();
    const result = await gateway.confirmPayment(paymentId);

    await this.paymentAuditService.logPaymentConfirmed({ userId, paymentId });

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
  @UseGuards(JwtAuthGuard, FeatureFlagGuard)
  @RequireFlag('payments.refunds')
  @UseGuards(JwtAuthGuard)
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 30, window: 60 })
  async refundPayment(
    @Param('id') paymentId: string,
    @Body('amount') amount: number | undefined,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    const gateway = this.gatewayFactory.getDefaultGateway();
    const result = await gateway.refundPayment(paymentId, amount);

    await this.paymentAuditService.logPaymentRefunded({ userId, paymentId, amount });

    return result;
  }

  @Post('webhooks/stripe')
  @RateLimit({ tier: RateLimitTier.PUBLIC, limit: 120, window: 60 })
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
