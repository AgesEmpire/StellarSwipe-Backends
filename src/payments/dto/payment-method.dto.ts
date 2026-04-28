import { IsString, IsNumber, IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class PaymentMethodDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsUUID()
  userId: string;

  @IsString()
  type: string; // 'card', 'bank', 'paypal'

  @IsString()
  provider: string; // 'stripe', 'paypal'

  @IsString()
  @IsOptional()
  displayName?: string; // e.g., "Visa ending in 4242"

  @IsString()
  @IsOptional()
  lastFour?: string;

  @IsString()
  @IsOptional()
  expiryMonth?: string;

  @IsString()
  @IsOptional()
  expiryYear?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsString()
  @IsOptional()
  fingerprint?: string; // For deduplication
}

export class SavePaymentMethodDto {
  @IsUUID()
  userId: string;

  @IsString()
  token: string; // Payment gateway token

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsBoolean()
  @IsOptional()
  setAsDefault?: boolean;
}

export class ListPaymentMethodsResponse {
  @IsString()
  id: string;

  @IsString()
  type: string;

  @IsString()
  displayName: string;

  @IsString()
  provider: string;

  @IsBoolean()
  isDefault: boolean;
}
