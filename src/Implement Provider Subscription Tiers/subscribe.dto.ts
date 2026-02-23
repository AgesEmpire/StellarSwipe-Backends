import { IsString, IsUUID, IsOptional, IsBoolean } from 'class-validator';

export class SubscribeDto {
  @IsUUID()
  tierId: string;

  @IsString()
  stellarAddress: string;

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;
}

export class CancelSubscriptionDto {
  @IsUUID()
  subscriptionId: string;

  @IsOptional()
  @IsBoolean()
  immediate?: boolean; // if true, cancel now; else cancel at period end
}
