import { IsString, IsNumber, IsOptional, IsUUID, IsEnum, ValidateNested, Type } from 'class-validator';
import { PaymentMethod } from '../interfaces/payment-provider.interface';

export class CreatePaymentDto {
  @IsUUID()
  userId: string;

  @IsNumber()
  amount: number;

  @IsString()
  currency: string; // 'USD', 'EUR', etc.

  @IsString()
  description: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsString()
  @IsOptional()
  returnUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  metadata?: Record<string, any>;
}

export class CreatePaymentResponse {
  @IsString()
  paymentId: string;

  @IsString()
  status: string;

  @IsNumber()
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  @IsOptional()
  redirectUrl?: string;

  @IsString()
  @IsOptional()
  clientSecret?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  metadata?: Record<string, any>;
}
