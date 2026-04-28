import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';

export class RefundDto {
  @IsUUID()
  paymentId: string;

  @IsNumber()
  @IsOptional()
  amount?: number; // If not provided, refund the full amount

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class RefundResponse {
  @IsString()
  refundId: string;

  @IsUUID()
  paymentId: string;

  @IsNumber()
  amount: number;

  @IsString()
  status: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  createdAt?: string;
}
