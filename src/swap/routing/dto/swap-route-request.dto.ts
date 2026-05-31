import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SwapRouteRequestDto {
  /** Source asset identifier: 'native' for XLM, or '<CODE>:<ISSUER>' for other assets */
  @IsString()
  @IsNotEmpty()
  sourceAsset!: string;

  /** Destination asset identifier */
  @IsString()
  @IsNotEmpty()
  destinationAsset!: string;

  /** Amount of source asset to swap */
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount!: number;

  /**
   * Optional whitelist of intermediate asset IDs that the route may pass through.
   * When omitted, all available assets are considered.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  allowedIntermediaryAssets?: string[];

  /**
   * Maximum number of hops (1 = direct swap only, up to 4).
   * Defaults to 3 when not specified.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  @Type(() => Number)
  maxHops?: number;

  /**
   * Minimum liquidity (in source-asset units) required at each hop.
   * Routes with insufficient liquidity are excluded.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minLiquidity?: number;
}
