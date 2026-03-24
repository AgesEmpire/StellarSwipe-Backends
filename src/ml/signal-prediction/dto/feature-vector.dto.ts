import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ProviderFeaturesDto {
  @ApiProperty({ description: 'Provider historical win rate', minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0) @Max(1)
  winRate!: number;

  @ApiProperty({ description: 'Provider reputation score', minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0) @Max(1)
  reputationScore!: number;

  @ApiProperty({ description: 'Signal consistency score', minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0) @Max(1)
  consistency!: number;

  @ApiProperty({ description: 'Average hold time in hours, normalized 0-1' })
  @IsNumber()
  @Min(0) @Max(1)
  avgHoldTimeHours!: number;

  @ApiProperty({ description: 'Total signals count, normalized 0-1' })
  @IsNumber()
  @Min(0) @Max(1)
  totalSignals!: number;

  @ApiProperty({ description: 'Win rate over last 20 signals', minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0) @Max(1)
  recentWinRate!: number;

  @ApiProperty({ description: 'Current streak score (-1 loss streak to +1 win streak)' })
  @IsNumber()
  @Min(-1) @Max(1)
  streakScore!: number;
}

export class MarketFeaturesDto {
  @ApiProperty({ description: 'Normalized asset price volatility', minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0) @Max(1)
  assetVolatility!: number;

  @ApiProperty({ description: 'Market trend: -1 bear, 0 neutral, 1 bull' })
  @IsNumber()
  @Min(-1) @Max(1)
  marketTrend!: number;

  @ApiProperty({ description: 'Volume ratio vs 7-day average, normalized 0-1' })
  @IsNumber()
  @Min(0) @Max(1)
  volumeRatio!: number;

  @ApiProperty({ description: 'RSI-14 normalized 0-1 (0.5 = 50 RSI)' })
  @IsNumber()
  @Min(0) @Max(1)
  rsiScore!: number;

  @ApiProperty({ description: 'Price deviation from moving average, normalized 0-1' })
  @IsNumber()
  @Min(0) @Max(1)
  priceDeviation!: number;
}

export class SignalFeaturesDto {
  @ApiProperty({ description: 'Signal confidence score', minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0) @Max(1)
  confidenceScore!: number;

  @ApiProperty({ description: 'Risk/reward ratio normalized 0-1' })
  @IsNumber()
  @Min(0) @Max(1)
  riskRewardRatio!: number;

  @ApiProperty({ description: 'Time of day normalized 0-1 (hour/24)' })
  @IsNumber()
  @Min(0) @Max(1)
  timeOfDay!: number;

  @ApiProperty({ description: 'Day of week normalized 0-1 (day/7)' })
  @IsNumber()
  @Min(0) @Max(1)
  dayOfWeek!: number;

  @ApiProperty({ description: 'Asset pair popularity normalized 0-1' })
  @IsNumber()
  @Min(0) @Max(1)
  assetPairPopularity!: number;
}

export class FeatureVectorDto {
  @ApiProperty({ type: ProviderFeaturesDto })
  provider!: ProviderFeaturesDto;

  @ApiProperty({ type: MarketFeaturesDto })
  market!: MarketFeaturesDto;

  @ApiProperty({ type: SignalFeaturesDto })
  signal!: SignalFeaturesDto;

  @ApiPropertyOptional({ type: [Number], description: 'Raw feature vector (17 values)' })
  @IsOptional()
  rawVector?: number[];
}
