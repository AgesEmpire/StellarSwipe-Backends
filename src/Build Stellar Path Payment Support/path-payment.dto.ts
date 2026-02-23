import { IsString, IsNumber, IsOptional, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssetDto {
  @ApiProperty({ example: 'USDC', description: 'Asset code (use "XLM" for native)' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' })
  @IsOptional()
  @IsString()
  issuer?: string; // undefined for XLM native asset
}

export class PathPaymentRequestDto {
  @ApiProperty({ description: 'Source account (sender) public key' })
  @IsString()
  sourceAccount: string;

  @ApiProperty({ description: 'Destination account (receiver) public key' })
  @IsString()
  destinationAccount: string;

  @ApiProperty({ type: AssetDto })
  @ValidateNested()
  @Type(() => AssetDto)
  sourceAsset: AssetDto;

  @ApiProperty({ type: AssetDto })
  @ValidateNested()
  @Type(() => AssetDto)
  destinationAsset: AssetDto;

  @ApiProperty({ example: '100', description: 'Amount destination receives' })
  @IsString()
  destinationAmount: string;

  @ApiPropertyOptional({ example: 0.5, description: 'Slippage tolerance percentage (0-100)', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  slippageTolerance?: number = 1;

  @ApiPropertyOptional({ description: 'Override with a specific path of assets' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssetDto)
  forcedPath?: AssetDto[];
}

export class PathResultDto {
  path: AssetDto[];
  sourceAmount: string;
  destinationAmount: string;
  slippage: number;
  hops: number;
  priceRatio: number;
}

export class PathPaymentResponseDto {
  success: boolean;
  transactionHash?: string;
  selectedPath: PathResultDto;
  allPaths: PathResultDto[];
  usedDirectTrade: boolean;
  error?: string;
}
