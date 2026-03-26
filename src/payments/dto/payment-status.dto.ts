import { IsString, IsEnum, IsDate, IsOptional, IsNumber } from 'class-validator';
import { PaymentStatus } from '../interfaces/payment-provider.interface';
import { Type } from 'class-transformer';

export class PaymentStatusDto {
  @IsString()
  paymentId: string;

  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  transactionId?: string;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  updatedAt?: Date;

  @IsString()
  @IsOptional()
  failureReason?: string;
}

export class PaymentStatusResponse {
  @IsString()
  paymentId: string;

  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @IsNumber()
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  @IsOptional()
  transactionId?: string;

  @IsDate()
  @Type(() => Date)
  createdAt: Date;

  @IsDate()
  @Type(() => Date)
  updatedAt: Date;
}
