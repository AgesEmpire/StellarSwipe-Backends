import {
  IsString,
  IsUUID,
  IsBoolean,
  IsOptional,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscribeDto {
  @ApiProperty({ description: 'UUID of the subscription tier to join' })
  @IsUUID()
  tierId!: string;

  @ApiProperty({
    example: 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTG',
    description: "Subscriber's Stellar wallet address (56-char G...)",
  })
  @IsString()
  @Length(56, 56)
  subscriberWallet!: string;

  @ApiProperty({
    example: 'abc123txhash...',
    description: 'Stellar transaction hash proving USDC payment was made',
  })
  @IsString()
  stellarTxHash!: string;

  @ApiPropertyOptional({ default: true, description: 'Opt into auto-renewal' })
  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({ description: 'Optional reason for cancellation' })
  @IsOptional()
  @IsString()
  reason?: string;

  /**
   * If true the subscription ends immediately; false = end at period_end.
   * Defaults to false (cancel at period end).
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}

export class RenewSubscriptionDto {
  @ApiProperty({
    example: 'abc123txhash...',
    description: 'Stellar transaction hash for the renewal payment',
  })
  @IsString()
  stellarTxHash!: string;
}
