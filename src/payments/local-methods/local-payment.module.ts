import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { LocalPaymentService } from './local-payment.service';
import { LocalPaymentController } from './local-payment.controller';
import { LocalPayment } from './entities/local-payment.entity';
import { PaymentConfig } from './entities/payment-config.entity';
import { MpesaProvider } from './providers/mpesa.provider';
import { PaystackProvider } from './providers/paystack.provider';
import { PixProvider } from './providers/pix.provider';
import { UpiProvider } from './providers/upi.provider';
import { RegionalRouter } from './utils/regional-router';
import { MpesaWebhookHandler } from './webhooks/mpesa-webhook.handler';
import { PaystackWebhookHandler } from './webhooks/paystack-webhook.handler';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([LocalPayment, PaymentConfig])],
  providers: [
    LocalPaymentService,
    MpesaProvider,
    PaystackProvider,
    PixProvider,
    UpiProvider,
    RegionalRouter,
    MpesaWebhookHandler,
    PaystackWebhookHandler,
  ],
  controllers: [LocalPaymentController],
  exports: [LocalPaymentService],
})
export class LocalPaymentModule {}
