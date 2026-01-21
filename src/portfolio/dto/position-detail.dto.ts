import { TradeSide } from '../../trades/entities/trade.entity';

export class PositionDetailDto {
  id!: string;
  assetSymbol!: string;
  amount!: number;
  entryPrice!: number;
  currentPrice!: number;
  unrealizedPnL!: number;
  side!: TradeSide;
  openedAt!: Date;
}
