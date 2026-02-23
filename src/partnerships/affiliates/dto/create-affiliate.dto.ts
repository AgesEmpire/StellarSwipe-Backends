import { IsString, IsOptional, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PayoutDetailsDto {
  @IsString()
  method: string;

  @IsOptional()
  @IsString()
  walletAddress?: string;

  @IsOptional()
  @IsString()
  bankAccount?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

export class CreateAffiliateDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  parentAffiliateCode?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PayoutDetailsDto)
  payoutDetails?: PayoutDetailsDto;
}
