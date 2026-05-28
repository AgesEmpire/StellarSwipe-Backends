import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PairMetadataDto {
  @ApiProperty() base!: string;
  @ApiProperty() quote!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() iconUrl?: string;
  @ApiProperty() liquidityRating!: 'high' | 'medium' | 'low' | 'unknown';
}

export class ProviderSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() successRate!: number;
  @ApiProperty() totalSignals!: number;
  @ApiProperty() reputationScore!: number;
}

export class SignalFeedItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() pair!: string;
  @ApiProperty() action!: 'BUY' | 'SELL';
  @ApiProperty() price!: string;
  @ApiPropertyOptional() rationale?: string | null;
  @ApiProperty({ type: ProviderSummaryDto }) provider!: ProviderSummaryDto;
  @ApiProperty() confidence!: number;
  @ApiProperty() timestamp!: Date;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() targetPrice?: string;
  @ApiPropertyOptional() stopLossPrice?: string | null;
  @ApiProperty({ type: PairMetadataDto }) pairMetadata!: PairMetadataDto;
  @ApiPropertyOptional() feedScore?: number;
}

export class SignalFeedResponseDto {
  @ApiProperty({ type: [SignalFeedItemDto] }) signals: SignalFeedItemDto[] = [];
  @ApiProperty({ nullable: true }) nextCursor: string | null = null;
  @ApiProperty() hasMore: boolean = false;
  @ApiPropertyOptional() page?: number;
  @ApiPropertyOptional() totalPages?: number;
}

// Keep backward-compat exports used by existing code
export class ProviderStats {
  successRate!: number;
  totalSignals!: number;
  activeSignals: number | undefined;
}

export class AssetInfo {
  pair!: string;
  currentPrice!: number;
  priceChange24h!: number;
}

export class SignalDto {
  id!: string;
  asset!: string;
  provider!: string;
  type!: 'BUY' | 'SELL';
  entryPrice!: number;
  targetPrice!: number;
  stopLoss!: number;
  status!: string;
  createdAt!: Date;
  expiresAt!: Date;
  popularity!: number;
  performance?: number;
  providerStats!: ProviderStats;
  assetInfo!: AssetInfo;
}
