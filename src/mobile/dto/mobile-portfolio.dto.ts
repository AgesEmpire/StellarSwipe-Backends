export class MobilePortfolioDto {
  bal: number;       // balance
  pnl: number;       // total pnl
  pnlPct: number;    // pnl percentage
  pos: CompactPositionDto[];
  ts: number;        // snapshot timestamp
}

export class CompactPositionDto {
  id: string;
  sym: string;
  qty: number;
  avg: number;       // avg entry price
  cur: number;       // current price
  pnl: number;
}
