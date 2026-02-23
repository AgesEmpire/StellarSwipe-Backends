export class OverviewDto {
  totalSignals!: number;
  totalCopiers!: number;
  totalRevenue!: number;
  avgCopiesPerSignal!: number;
}

export class PerformanceByAssetDto {
  asset!: string;
  winRate!: number;
}

export class RevenueChartDto {
  date!: string;
  amount!: number;
}

export class TopSignalDto {
  id!: string;
  assetPair!: string;
  copies!: number;
  createdAt!: string;
}

export class AnalyticsResponseDto {
  overview!: OverviewDto;
  performanceByAsset!: PerformanceByAssetDto[];
  revenueChart!: RevenueChartDto[];
  topSignals!: TopSignalDto[];
}
