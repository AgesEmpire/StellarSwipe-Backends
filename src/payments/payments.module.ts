import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { StripePaymentService } from './gateways/stripe/stripe-payment.service';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import { AuthModule } from '../auth/auth.module';
import { WebhookIdempotencyModule } from '../common/webhook-idempotency.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [ConfigModule, AuthModule, WebhookIdempotencyModule, FeatureFlagsModule],
  controllers: [PaymentsController],
  providers: [StripePaymentService, PaymentGatewayFactory],
  exports: [StripePaymentService, PaymentGatewayFactory],
})
export class PaymentsModule {}
