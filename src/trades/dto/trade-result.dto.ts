import { TradeStatus, TradeSide } from '../entities/trade.entity';

export class TradeResultDto {
  id!: string;
  userId!: string;
  signalId!: string;
  status!: TradeStatus;
  side!: TradeSide;
  baseAsset!: string;
  counterAsset!: string;
  entryPrice!: string;
  amount!: string;
  totalValue!: string;
  feeAmount!: string;
  transactionHash?: string;
  executedAt?: Date;
  message!: string;
}

export class TradeDetailsDto {
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
  stopLossPrice?: string;
  takeProfitPrice?: string;
  transactionHash?: string;
  sorobanContractId?: string;
  errorMessage?: string;
  executedAt?: Date;
  closedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export class TradeValidationResultDto {
  isValid!: boolean;
  errors!: string[];
  warnings!: string[];
  estimatedFee?: string;
  estimatedTotalCost?: string;
}

export class UserTradesSummaryDto {
  totalTrades!: number;
  openTrades!: number;
  completedTrades!: number;
  failedTrades!: number;
  totalProfitLoss!: string;
  winRate!: string;
  averageProfitLoss!: string;
}

export class CloseTradeResultDto {
  id!: string;
  status!: TradeStatus;
  exitPrice!: string;
  profitLoss!: string;
  profitLossPercentage!: string;
  transactionHash?: string;
  closedAt!: Date;
  message!: string;
}
