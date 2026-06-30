import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Asset, AssetType } from './entities/asset.entity';
import { AssetPair } from './entities/asset-pair.entity';
import { CreateAssetDto, AssetPriceDto, AssetDto, AssetPairDto } from './dto/asset-price.dto';
import axios from 'axios';
import { TrustlineEstablishmentService } from './trustline-establishment.service';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly HORIZON_BASE_URL = 'https://horizon.stellar.org';
  private readonly PRICE_CACHE_TTL = 60 * 1000; // 60 seconds
  private readonly PRICE_CACHE_KEY_PREFIX = 'asset_price:';

  constructor(
    @InjectRepository(Asset)
    private assetRepository: Repository<Asset>,
    @InjectRepository(AssetPair)
    private assetPairRepository: Repository<AssetPair>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private trustlineService: TrustlineEstablishmentService,
  ) {
    this.initializeCoreAssets();
  }

  /**
   * Initialize core assets on service startup
   */
  private async initializeCoreAssets() {
    try {
      const coreAssets = [
        {
          code: 'XLM',
          issuer: null,
          type: AssetType.NATIVE,
          name: 'Stellar Lumens',
          description: 'Native currency of Stellar network',
          logoUrl: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol-white-circles.png',
          isVerified: true,
          isPopular: true,
        },
        {
          code: 'USDC',
          issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47GDEVS2HW6LBX4KIFNDUYAPG',
          type: AssetType.ISSUED,
          name: 'Circle USD Coin',
          description: 'Fully collateralized US dollar stablecoin',
          logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
          isVerified: true,
          isPopular: true,
        },
        {
          code: 'AQUA',
          issuer: 'GBNZILSTVQSRDG5OKDJVVVX3VS3ZGGF3BYRTOJSQHXLWMCBOGB2CBJBJ',
          type: AssetType.ISSUED,
          name: 'Aqua Token',
          description: 'AquaNetwork governance token',
          logoUrl: 'https://assets.coingecko.com/coins/images/14468/small/aqua.png',
          isVerified: true,
          isPopular: true,
        },
        {
          code: 'yXLM',
          issuer: 'GARDNV3Q7YKM4CMWQ2P3QZZQ2CJX7Y6MPJZR5YFHP2XGFPZ6LNKFVSX3',
          type: AssetType.ISSUED,
          name: 'Ultra Stellar',
          description: 'Ultra Stellar token',
          logoUrl: 'https://assets.coingecko.com/coins/images/22122/small/yxlm_logo.png',
          isVerified: true,
          isPopular: false,
        },
      ];

      for (const assetData of coreAssets) {
        let exists;
        if (assetData.issuer === null) {
          exists = await this.assetRepository.findOne({
            where: { code: assetData.code, issuer: IsNull() },
          });
        } else {
          exists = await this.assetRepository.findOne({
            where: { code: assetData.code, issuer: assetData.issuer },
          });
        }

        if (!exists) {
          await this.assetRepository.save(assetData);
          this.logger.log(`Created core asset: ${assetData.code}`);
        }
      }

      // Initialize core trading pairs
      await this.initializeCorePairs();
    } catch (error) {
      this.logger.error('Error initializing core assets:', error);
    }
  }

  /**
   * Initialize core trading pairs
   */
  private async initializeCorePairs() {
    try {
      const xlm = await this.assetRepository.findOne({ where: { code: 'XLM' } });
      const usdc = await this.assetRepository.findOne({ where: { code: 'USDC' } });
      const aqua = await this.assetRepository.findOne({ where: { code: 'AQUA' } });

      if (xlm && usdc) {
        const pair1 = await this.assetPairRepository.findOne({
          where: { baseAssetId: xlm.id, counterAssetId: usdc.id },
        });
        if (!pair1) {
          await this.assetPairRepository.save({
            baseAsset: xlm,
            counterAsset: usdc,
            isTradable: true,
          });
          this.logger.log('Created pair: XLM/USDC');
        }
      }

      if (usdc && xlm) {
        const pair2 = await this.assetPairRepository.findOne({
          where: { baseAssetId: usdc.id, counterAssetId: xlm.id },
        });
        if (!pair2) {
          await this.assetPairRepository.save({
            baseAsset: usdc,
            counterAsset: xlm,
            isTradable: true,
          });
          this.logger.log('Created pair: USDC/XLM');
        }
      }

      if (aqua && xlm) {
        const pair3 = await this.assetPairRepository.findOne({
          where: { baseAssetId: aqua.id, counterAssetId: xlm.id },
        });
        if (!pair3) {
          await this.assetPairRepository.save({
            baseAsset: aqua,
            counterAsset: xlm,
            isTradable: true,
          });
          this.logger.log('Created pair: AQUA/XLM');
        }
      }
    } catch (error) {
      this.logger.error('Error initializing core pairs:', error);
    }
  }

  /**
   * Get all supported assets
   */
  async getAllAssets(): Promise<AssetDto[]> {
    const assets = await this.assetRepository.find({
      order: { isPopular: 'DESC', popularity: 'DESC', createdAt: 'ASC' },
    });

    return assets.map(this.mapAssetToDto);
  }

  /**
   * Get all tradable asset pairs
   */
  async getAssetPairs(): Promise<AssetPairDto[]> {
    const pairs = await this.assetPairRepository.find({
      where: { isTradable: true },
      relations: ['baseAsset', 'counterAsset'],
      order: { createdAt: 'ASC' },
    });

    return pairs.map((pair) => this.mapPairToDto(pair));
  }

  /**
   * Get price for a specific asset pair
   */
  async getAssetPrice(pair: string): Promise<AssetPriceDto | null> {
    const cacheKey = this.PRICE_CACHE_KEY_PREFIX + pair;

    // Try to get from cache first
    const cached = await this.cacheManager.get<AssetPriceDto>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const price = await this.fetchPriceFromHorizon(pair);
      if (price) {
        // Cache the price for 60 seconds
        await this.cacheManager.set(cacheKey, price, this.PRICE_CACHE_TTL);
      }
      return price;
    } catch (error) {
      this.logger.error(`Error fetching price for pair ${pair}:`, error);
      return null;
    }
  }

  /**
   * Validate if asset pair is tradable
   */
  async validateAssetPair(baseAssetCode: string, counterAssetCode: string): Promise<boolean> {
    const baseAsset = await this.assetRepository.findOne({
      where: { code: baseAssetCode },
    });

    const counterAsset = await this.assetRepository.findOne({
      where: { code: counterAssetCode },
    });

    if (!baseAsset || !counterAsset) {
      return false;
    }

    const pair = await this.assetPairRepository.findOne({
      where: {
        baseAssetId: baseAsset.id,
        counterAssetId: counterAsset.id,
        isTradable: true,
      },
    });

    return !!pair;
  }

  /**
   * Create a new asset
   */
  async createAsset(createAssetDto: CreateAssetDto): Promise<Asset> {
    // Validate asset code length
    if (createAssetDto.code.length > 12) {
      throw new BadRequestException('Asset code must be 12 characters or less');
    }

    // Check if asset already exists
    let existing;
    if (!createAssetDto.issuer) {
      existing = await this.assetRepository.findOne({
        where: { code: createAssetDto.code, issuer: IsNull() },
      });
    } else {
      existing = await this.assetRepository.findOne({
        where: { code: createAssetDto.code, issuer: createAssetDto.issuer },
      });
    }

    if (existing) {
      throw new BadRequestException('Asset already exists');
    }

    // For non-native assets, issuer is required
    if (createAssetDto.issuer === undefined && createAssetDto.code !== 'XLM') {
      throw new BadRequestException('Issuer is required for non-native assets');
    }

    const asset = this.assetRepository.create({
      code: createAssetDto.code,
      issuer: createAssetDto.issuer || null,
      type: createAssetDto.issuer ? AssetType.ISSUED : AssetType.NATIVE,
      name: createAssetDto.name,
      description: createAssetDto.description || null,
      logoUrl: createAssetDto.logoUrl || null,
      isVerified: createAssetDto.isVerified || false,
      isPopular: createAssetDto.isPopular || false,
      metadata: createAssetDto.metadata || null,
    });

    const savedAsset = await this.assetRepository.save(asset);

    if (savedAsset.type === AssetType.ISSUED) {
      this.trustlineService.establishTrustlinesForAsset(savedAsset.id).catch(error => {
        this.logger.error(`Failed to establish trustlines for asset ${savedAsset.id}: ${error.message}`);
      });
    }

    return savedAsset;
  }

  /**
   * Create a trading pair
   */
  async createAssetPair(baseAssetId: string, counterAssetId: string): Promise<AssetPair> {
    // Validate assets exist
    const baseAsset = await this.assetRepository.findOne({ where: { id: baseAssetId } });
    const counterAsset = await this.assetRepository.findOne({ where: { id: counterAssetId } });

    if (!baseAsset || !counterAsset) {
      throw new NotFoundException('One or both assets not found');
    }

    // Check if pair already exists
    const existing = await this.assetPairRepository.findOne({
      where: { baseAssetId, counterAssetId },
    });

    if (existing) {
      throw new BadRequestException('Asset pair already exists');
    }

    const pair = this.assetPairRepository.create({
      baseAsset,
      counterAsset,
      isTradable: true,
    });

    return this.assetPairRepository.save(pair);
  }

  /**
   * Fetch price from Stellar Horizon API
   */
  private async fetchPriceFromHorizon(pair: string): Promise<AssetPriceDto | null> {
    try {
      const [baseCode, counterCode] = pair.split('/');

      if (!baseCode || !counterCode) {
        throw new BadRequestException('Invalid pair format. Use BASE/COUNTER');
      }

      const baseAsset = await this.assetRepository.findOne({
        where: { code: baseCode },
      });

      const counterAsset = await this.assetRepository.findOne({
        where: { code: counterCode },
      });

      if (!baseAsset || !counterAsset) {
        throw new NotFoundException('One or both assets not found');
      }

      // Build orderbook URL
      const orderBookUrl = this.buildOrderbookUrl(baseAsset, counterAsset);

      const response = await axios.get(orderBookUrl, {
        timeout: 10000,
      });

      const orderBook = response.data;

      if (!orderBook.asks || !orderBook.bids || orderBook.asks.length === 0 || orderBook.bids.length === 0) {
        return null;
      }

      // Calculate prices from orderbook
      const bestAsk = parseFloat(orderBook.asks[0].price);
      const bestBid = parseFloat(orderBook.bids[0].price);
      const lastPrice = (bestAsk + bestBid) / 2;

      // Calculate volumes
      const baseVolume = orderBook.asks.reduce((sum: number, order: any) => sum + parseFloat(order.amount), 0);
      const counterVolume = baseVolume * lastPrice;

      return {
        pair,
        lastPrice: lastPrice.toString(),
        bidPrice: bestBid.toString(),
        askPrice: bestAsk.toString(),
        baseVolume24h: baseVolume.toString(),
        counterVolume24h: counterVolume.toString(),
        tradeCount24h: orderBook.asks.length + orderBook.bids.length,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`Error fetching price from Horizon for ${pair}:`, error);
      return null;
    }
  }

  /**
   * Build Horizon orderbook URL
   */
  private buildOrderbookUrl(baseAsset: Asset, counterAsset: Asset): string {
    const baseParams = baseAsset.type === AssetType.NATIVE
      ? 'selling_asset_type=native'
      : `selling_asset_code=${baseAsset.code}&selling_asset_issuer=${baseAsset.issuer}&selling_asset_type=credit_alphanum12`;

    const counterParams = counterAsset.type === AssetType.NATIVE
      ? 'buying_asset_type=native'
      : `buying_asset_code=${counterAsset.code}&buying_asset_issuer=${counterAsset.issuer}&buying_asset_type=credit_alphanum12`;

    return `${this.HORIZON_BASE_URL}/order_book?${baseParams}&${counterParams}&limit=20`;
  }

  /**
   * Update asset pair price from Horizon
   */
  async updateAssetPairPrice(pairId: string): Promise<AssetPair> {
    const pair = await this.assetPairRepository.findOne({
      where: { id: pairId },
      relations: ['baseAsset', 'counterAsset'],
    });

    if (!pair) {
      throw new NotFoundException('Asset pair not found');
    }

    const pairIdentifier = pair.getPairIdentifier();
    const price = await this.getAssetPrice(pairIdentifier);

    if (price) {
      pair.lastPrice = price.lastPrice;
        pair.bidPrice = price.bidPrice || null;
        pair.askPrice = price.askPrice || null;
      pair.tradeCount24h = price.tradeCount24h || 0;
      pair.lastPriceUpdate = new Date();

      return this.assetPairRepository.save(pair);
    }

    return pair;
  }

  /**
   * Get asset by code
   */
  async getAssetByCode(code: string): Promise<Asset> {
    const asset = await this.assetRepository.findOne({ where: { code } });

    if (!asset) {
      throw new NotFoundException(`Asset with code ${code} not found`);
    }

    return asset;
  }

  /**
   * Batch lookup for multiple asset codes (used by GraphQL DataLoader)
   */
  async findByCodes(codes: readonly string[]): Promise<Asset[]> {
    if (!codes || codes.length === 0) return [];
    const unique = Array.from(new Set(codes as string[]));
    const assets = await this.assetRepository.find({ where: unique.map((c) => ({ code: c })) });
    return assets;
  }

  /**
   * Check if asset exists
   */
  async assetExists(code: string, issuer?: string): Promise<boolean> {
    let asset;
    if (!issuer) {
      asset = await this.assetRepository.findOne({
        where: { code, issuer: IsNull() },
      });
    } else {
      asset = await this.assetRepository.findOne({
        where: { code, issuer },
      });
    }
    return !!asset;
  }

  /**
   * Clear price cache for a pair
   */
  async clearPriceCache(pair: string): Promise<void> {
    const cacheKey = this.PRICE_CACHE_KEY_PREFIX + pair;
    await this.cacheManager.del(cacheKey);
  }

  /**
   * Clear all price caches
   */
  async clearAllPriceCaches(): Promise<void> {
    const allPairs = await this.assetPairRepository.find({
      relations: ['baseAsset', 'counterAsset'],
    });

    for (const pair of allPairs) {
      const pairIdentifier = pair.getPairIdentifier();
      await this.clearPriceCache(pairIdentifier);
    }
  }

  /**
   * Map Asset entity to DTO
   */
  private mapAssetToDto(asset: Asset): AssetDto {
    return {
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
  }

  /**
   * Map AssetPair entity to DTO
   */
  private mapPairToDto(pair: AssetPair): AssetPairDto {
    return {
      id: pair.id,
      baseAsset: this.mapAssetToDto(pair.baseAsset),
      counterAsset: this.mapAssetToDto(pair.counterAsset),
      isTradable: pair.isTradable,
      lastPrice: pair.lastPrice,
      bidPrice: pair.bidPrice,
      askPrice: pair.askPrice,
      baseVolume24h: pair.baseVolume24h,
      counterVolume24h: pair.counterVolume24h,
      tradeCount24h: pair.tradeCount24h,
      lastPriceUpdate: pair.lastPriceUpdate,
    };
  }
}
