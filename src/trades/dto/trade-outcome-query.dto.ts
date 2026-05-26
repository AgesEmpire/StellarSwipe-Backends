import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { TradeStatus } from '../entities/trade.entity';

export class TradeOutcomeQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  transactionId?: string;

  @IsOptional()
  @IsEnum(TradeStatus)
  status?: TradeStatus;
}
