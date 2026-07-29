import { IsString, IsNumber, IsPositive, Matches, IsOptional, IsObject } from 'class-validator';

export class MpesaPaymentDto {
  @IsString()
  userId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @Matches(/^\+2547\d{8}$/, { message: 'Phone number must be in format +2547XXXXXXXX' })
  phoneNumber!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
