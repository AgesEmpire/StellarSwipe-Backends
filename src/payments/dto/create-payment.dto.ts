import { IsNumber, IsString, IsOptional, IsEnum, Min } from 'class-validator';
import { PaymentGatewayType } from '../gateways/payment-gateway.factory';

export class CreatePaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  currency: string;

  @IsEnum(PaymentGatewayType)
  @IsOptional()
  gateway?: PaymentGatewayType;

  @IsOptional()
  metadata?: Record<string, any>;
}
