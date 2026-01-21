export class PortfolioSummaryDto {
  totalValue!: number;
  unrealizedPnL!: number;
  realizedPnL!: number;
  openPositions!: number;
  winRate!: number;
  bestTrade: any;
  worstTrade: any;
}
