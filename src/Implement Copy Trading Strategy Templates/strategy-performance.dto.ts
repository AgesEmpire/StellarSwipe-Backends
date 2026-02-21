import { ApiProperty } from '@nestjs/swagger';

export class StrategyPerformanceDto {
  @ApiProperty()
  userStrategyId: string;

  @ApiProperty()
  templateId: string;

  @ApiProperty()
  templateName: string;

  @ApiProperty()
  riskLevel: string;

  @ApiProperty()
  totalSignalsReceived: number;

  @ApiProperty()
  signalsFiltered: number;

  @ApiProperty()
  signalsExecuted: number;

  @ApiProperty()
  profitableTrades: number;

  @ApiProperty()
  totalPnl: number;

  @ApiProperty()
  winRate: number;

  @ApiProperty()
  avgReturnPerTrade: number;

  @ApiProperty()
  maxDrawdown: number;

  @ApiProperty()
  sharpeRatio: number;

  @ApiProperty()
  filterRate: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  appliedAt: Date;
}
