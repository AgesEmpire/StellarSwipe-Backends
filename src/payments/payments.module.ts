import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { StripePaymentService } from './gateways/stripe/stripe-payment.service';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [PaymentsController],
  providers: [StripePaymentService, PaymentGatewayFactory],
  exports: [StripePaymentService, PaymentGatewayFactory],
})
export class PaymentsModule {}
