import { IsNumber, IsOptional, Min, Max, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SlippageToleranceLevel {
  STRICT = 'STRICT',
  MODERATE = 'MODERATE',
  RELAXED = 'RELAXED',
}

export class SlippageConfigDto {
  @ApiProperty({
    description: 'Maximum allowed slippage percentage (0-100)',
    example: 0.5,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  maxSlippagePercent: number = 0.5;

  @ApiPropertyOptional({
    description: 'Predefined slippage tolerance level',
    enum: SlippageToleranceLevel,
    example: SlippageToleranceLevel.MODERATE,
  })
  @IsOptional()
  @IsEnum(SlippageToleranceLevel)
  toleranceLevel?: SlippageToleranceLevel = SlippageToleranceLevel.MODERATE;

  @ApiPropertyOptional({
    description: 'Enable automatic slippage adjustment based on market conditions',
    example: true,
  })
  @IsOptional()
  enableDynamicSlippage?: boolean = true;

  @ApiPropertyOptional({
    description: 'Maximum execution time in milliseconds before considering price stale',
    example: 5000,
    minimum: 100,
    maximum: 30000,
  })
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(30000)
  maxExecutionTimeMs?: number = 5000;
}

export class SlippageEstimationDto {
  @ApiProperty({
    description: 'Symbol/trading pair',
    example: 'BTC/USD',
  })
  symbol: string = '';

  @ApiProperty({
    description: 'Trade side (buy/sell)',
    example: 'buy',
  })
  side: 'buy' | 'sell' = 'buy';

  @ApiProperty({
    description: 'Order size/quantity',
    example: 1.5,
  })
  @IsNumber()
  @Min(0)
  quantity: number = 0;

  @ApiPropertyOptional({
    description: 'Expected price for the trade',
    example: 45000.50,
  })
  @IsOptional()
  @IsNumber()
  expectedPrice?: number;
}

export class SlippageReportDto {
  @ApiProperty({
    description: 'Expected price before execution',
    example: 45000.00,
  })
  expectedPrice: number = 0;

  @ApiProperty({
    description: 'Actual execution price',
    example: 45022.50,
  })
  actualPrice: number = 0;

  @ApiProperty({
    description: 'Slippage amount in currency units',
    example: 22.50,
  })
  slippageAmount: number = 0;

  @ApiProperty({
    description: 'Slippage percentage',
    example: 0.05,
  })
  slippagePercent: number = 0;

  @ApiProperty({
    description: 'Trade quantity',
    example: 1.5,
  })
  quantity: number = 0;

  @ApiProperty({
    description: 'Total cost impact of slippage',
    example: 33.75,
  })
  totalSlippageCost: number = 0;

  @ApiProperty({
    description: 'Whether slippage was within acceptable limits',
    example: true,
  })
  withinLimits: boolean = true;

  @ApiProperty({
    description: 'Timestamp of the report',
    example: '2026-01-21T10:30:00Z',
  })
  timestamp: Date = new Date();

  @ApiProperty({
    description: 'Trading symbol',
    example: 'BTC/USD',
  })
  symbol: string = '';

  @ApiProperty({
    description: 'Trade side',
    example: 'buy',
  })
  side: 'buy' | 'sell' = 'buy';
}

export class SlippageEstimateResponseDto {
  @ApiProperty({
    description: 'Estimated slippage percentage',
    example: 0.12,
  })
  estimatedSlippagePercent: number = 0;

  @ApiProperty({
    description: 'Estimated slippage amount',
    example: 54.00,
  })
  estimatedSlippageAmount: number = 0;

  @ApiProperty({
    description: 'Current market price',
    example: 45000.00,
  })
  currentMarketPrice: number = 0;

  @ApiProperty({
    description: 'Estimated execution price range',
    example: { min: 44946.00, max: 45054.00 },
  })
  estimatedPriceRange: {
    min: number;
    max: number;
  } = { min: 0, max: 0 };

  @ApiProperty({
    description: 'Market liquidity indicator (0-1, higher is better)',
    example: 0.85,
  })
  liquidityScore: number = 0;

  @ApiProperty({
    description: 'Recommended action based on current conditions',
    example: 'proceed',
  })
  recommendation: 'proceed' | 'caution' | 'delay' = 'proceed';

  @ApiProperty({
    description: 'Reasoning for the recommendation',
    example: 'Market conditions are favorable with good liquidity',
  })
  reasoning: string = '';
}