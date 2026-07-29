import { IsString, IsNumber, IsPositive, IsEmail, IsOptional, IsObject, IsIn } from 'class-validator';

export class PaystackPaymentDto {
  @IsString()
  userId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @IsIn(['NGN', 'GHS', 'ZAR', 'KES'])
  currency!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
