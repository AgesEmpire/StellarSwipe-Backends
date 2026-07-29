import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPaymentGateway } from './payment-gateway.interface';
import { StripePaymentService } from './stripe/stripe-payment.service';

export enum PaymentGatewayType {
  STRIPE = 'stripe',
  PAYPAL = 'paypal',
  SQUARE = 'square',
}

@Injectable()
export class PaymentGatewayFactory {
  constructor(
    private configService: ConfigService,
    private stripeService: StripePaymentService,
  ) {}

  getGateway(type: PaymentGatewayType): IPaymentGateway {
    switch (type) {
      case PaymentGatewayType.STRIPE:
        return this.stripeService as any; // Cast to interface
      case PaymentGatewayType.PAYPAL:
        throw new BadRequestException('PayPal gateway not yet implemented');
      case PaymentGatewayType.SQUARE:
        throw new BadRequestException('Square gateway not yet implemented');
      default:
        throw new BadRequestException(`Unknown payment gateway: ${type}`);
    }
  }

  getDefaultGateway(): IPaymentGateway {
    const defaultType = this.configService.get<PaymentGatewayType>(
      'payments.defaultGateway',
      PaymentGatewayType.STRIPE,
    );
    return this.getGateway(defaultType);
  }
}
