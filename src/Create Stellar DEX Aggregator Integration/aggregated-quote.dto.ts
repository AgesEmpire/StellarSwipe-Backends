import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ─── Aggregated Quote DTO ───────────────────────────────────────────────────

export class StellarAssetDto {
  @ApiProperty({ example: 'USDC' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
  @IsOptional()
  @IsString()
  issuer?: string;

  @ApiProperty({ enum: ['native', 'credit_alphanum4', 'credit_alphanum12'] })
  @IsEnum(['native', 'credit_alphanum4', 'credit_alphanum12'])
  type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
}

export class DexQuoteItemDto {
  @ApiProperty({ example: 'lobstr' })
  dexId: string;

  @ApiProperty({ example: 'Lobstr' })
  dexName: string;

  @ApiProperty({ example: '100.0000000' })
  sourceAmount: string;

  @ApiProperty({ example: '98.5000000' })
  destinationAmount: string;

  @ApiProperty({ example: 0.985 })
  price: number;

  @ApiProperty({ example: 1.0152 })
  priceInverse: number;

  @ApiProperty({ example: 0.003 })
  fee: number;

  @ApiProperty({ example: 0.15 })
  estimatedSlippage: number;

  @ApiProperty({ example: 0.9 })
  confidence: number;

  @ApiProperty()
  expiresAt: Date;
}

export class AggregatedQuoteDto {
  @ApiProperty({ type: () => DexQuoteItemDto })
  bestQuote: DexQuoteItemDto;

  @ApiProperty({ type: () => [DexQuoteItemDto] })
  allQuotes: DexQuoteItemDto[];

  @ApiProperty({ example: 3 })
  dexesQueried: number;

  @ApiProperty({ example: 2 })
  dexesResponded: number;

  @ApiProperty({ example: 150 })
  aggregationTimeMs: number;

  @ApiProperty()
  timestamp: Date;
}

// ─── DEX Comparison DTO ────────────────────────────────────────────────────

export class DexComparisonItemDto {
  @ApiProperty()
  dexId: string;

  @ApiProperty()
  dexName: string;

  @ApiProperty()
  price: number;

  @ApiProperty()
  fee: number;

  @ApiProperty()
  estimatedSlippage: number;

  @ApiProperty()
  netPrice: number; // price after fees

  @ApiProperty()
  rank: number;

  @ApiProperty()
  priceDifferencePercent: number; // vs best price

  @ApiProperty()
  isHealthy: boolean;
}

export class DexComparisonDto {
  @ApiProperty({ type: () => [DexComparisonItemDto] })
  comparisons: DexComparisonItemDto[];

  @ApiProperty()
  bestDexId: string;

  @ApiProperty()
  worstDexId: string;

  @ApiProperty()
  spreadPercent: number; // best vs worst price spread

  @ApiProperty()
  timestamp: Date;
}

// ─── Optimal Route DTO ─────────────────────────────────────────────────────

export class RouteHopDto {
  @ApiProperty({ type: () => StellarAssetDto })
  fromAsset: StellarAssetDto;

  @ApiProperty({ type: () => StellarAssetDto })
  toAsset: StellarAssetDto;

  @ApiProperty()
  dexId: string;

  @ApiProperty()
  expectedOutput: string;

  @ApiProperty()
  poolId?: string;
}

export class SplitAllocationDto {
  @ApiProperty()
  dexId: string;

  @ApiProperty()
  dexName: string;

  @ApiProperty()
  allocationPercent: number;

  @ApiProperty()
  sourceAmount: string;

  @ApiProperty()
  expectedDestinationAmount: string;
}

export class OptimalRouteDto {
  @ApiProperty()
  routeId: string;

  @ApiProperty({ enum: ['single', 'split', 'multi-hop'] })
  routeType: 'single' | 'split' | 'multi-hop';

  @ApiProperty()
  sourceAmount: string;

  @ApiProperty()
  expectedDestinationAmount: string;

  @ApiProperty()
  minimumDestinationAmount: string; // after slippage

  @ApiProperty({ type: () => [RouteHopDto] })
  hops: RouteHopDto[];

  @ApiProperty({ type: () => [SplitAllocationDto], required: false })
  splits?: SplitAllocationDto[];

  @ApiProperty()
  totalFee: number;

  @ApiProperty()
  estimatedSlippage: number;

  @ApiProperty()
  priceImpact: number;

  @ApiProperty()
  confidence: number;

  @ApiProperty()
  optimizationScore: number; // composite score 0-100

  @ApiProperty()
  estimatedExecutionTimeMs: number;

  @ApiProperty()
  expiresAt: Date;
}
