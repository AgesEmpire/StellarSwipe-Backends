import { IsUUID, IsOptional, IsNumber, IsString, IsDateString, Min } from 'class-validator';

export class SubscribePremiumDto {
  @IsUUID()
  providerId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amountPaid?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdatePremiumSignalDto {
  @IsOptional()
  isPremium?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  premiumPrice?: number;

  @IsOptional()
  @IsString()
  premiumCurrency?: string;
}
