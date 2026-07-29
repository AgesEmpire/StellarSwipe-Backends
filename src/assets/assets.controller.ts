import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Header,
  Res,
  Req,
} from '@nestjs/common';
import { Response, Request } from 'express';
import * as crypto from 'crypto';
import { AssetsService } from './assets.service';
import { CreateAssetDto, AssetPriceDto, AssetDto, AssetPairDto } from './dto/asset-price.dto';
import { Asset } from './entities/asset.entity';

/** Cache-Control max-age for static asset metadata (1 hour) */
const ASSET_CACHE_TTL = 3600;
/** Cache-Control max-age for live price data (30 seconds) */
const PRICE_CACHE_TTL = 30;

function generateETag(data: unknown): string {
  return `"${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')}"`;
}

function setCacheHeaders(
  res: Response,
  data: unknown,
  maxAge: number,
): boolean {
  const etag = generateETag(data);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
  res.setHeader('Vary', 'Accept-Encoding');
  return etag === res.req?.headers?.['if-none-match'];
}

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /**
   * Get all supported assets
   * GET /assets
   */
  @Get()
  async getAllAssets(@Res({ passthrough: true }) res: Response): Promise<AssetDto[] | void> {
    const data = await this.assetsService.getAllAssets();
    if (setCacheHeaders(res, data, ASSET_CACHE_TTL)) {
      res.status(304).end();
      return;
    }
    return data;
  }

  /**
   * Get all tradable asset pairs
   * GET /assets/pairs
   */
  @Get('pairs')
  async getAssetPairs(@Res({ passthrough: true }) res: Response): Promise<AssetPairDto[] | void> {
    const data = await this.assetsService.getAssetPairs();
    if (setCacheHeaders(res, data, ASSET_CACHE_TTL)) {
      res.status(304).end();
      return;
    }
    return data;
  }

  /**
   * Get current price for a specific asset pair
   * GET /assets/price/:pair
   * Example: GET /assets/price/XLM/USDC
   */
  @Get('price/:pair')
  async getAssetPrice(
    @Param('pair') pair: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssetPriceDto | { error: string } | void> {
    if (!pair || !pair.includes('/')) {
      throw new BadRequestException('Invalid pair format. Use BASE/COUNTER format.');
    }

    const price = await this.assetsService.getAssetPrice(pair);

    if (!price) {
      return { error: `Unable to fetch price for pair ${pair}` };
    }

    if (setCacheHeaders(res, price, PRICE_CACHE_TTL)) {
      res.status(304).end();
      return;
    }
    return price;
  }

  /**
   * Validate if an asset pair is tradable
   * GET /assets/validate/:baseCode/:counterCode
   */
  @Get('validate/:baseCode/:counterCode')
  async validateAssetPair(
    @Param('baseCode') baseCode: string,
    @Param('counterCode') counterCode: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ isValid: boolean; pair: string } | void> {
    const isValid = await this.assetsService.validateAssetPair(baseCode, counterCode);
    const data = { isValid, pair: `${baseCode}/${counterCode}` };
    if (setCacheHeaders(res, data, ASSET_CACHE_TTL)) {
      res.status(304).end();
      return;
    }
    return data;
  }

  /**
   * Get a specific asset by code
   * GET /assets/:code
   */
  @Get(':code')
  async getAssetByCode(
    @Param('code') code: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssetDto | void> {
    const asset = await this.assetsService.getAssetByCode(code);
    const data: AssetDto = {
      id: asset.id,
      code: asset.code,
      issuer: asset.issuer,
      name: asset.name,
      description: asset.description,
      logoUrl: asset.logoUrl,
      isVerified: asset.isVerified,
      isPopular: asset.isPopular,
      type: asset.type,
      createdAt: asset.createdAt,
    };
    if (setCacheHeaders(res, data, ASSET_CACHE_TTL)) {
      res.status(304).end();
      return;
    }
    return data;
  }

  /**
   * Create a new asset
   * POST /assets
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAsset(@Body() createAssetDto: CreateAssetDto): Promise<Asset> {
    return this.assetsService.createAsset(createAssetDto);
  }
}
