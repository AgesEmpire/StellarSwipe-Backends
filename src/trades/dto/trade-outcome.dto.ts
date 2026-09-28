import { TradeStatus, TradeSide } from '../entities/trade.entity';

export class TradeOutcomeDto {
  id!: string;
  userId!: string;
  signalId!: string;
  status!: TradeStatus;
  side!: TradeSide;
  baseAsset!: string;
  counterAsset!: string;
  entryPrice!: string;
  exitPrice?: string;
  amount!: string;
  totalValue!: string;
  feeAmount!: string;
  profitLoss?: string;
  profitLossPercentage?: string;
  transactionHash?: string;
  sorobanContractId?: string;
  failureReason?: string;
  executedAt?: Date;
  closedAt?: Date;
  createdAt!: Date;
  isFinal!: boolean;
}
